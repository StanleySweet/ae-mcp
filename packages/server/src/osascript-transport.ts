import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { discoverAEVersions } from '@ae-mcp/core';
import {
  PROTOCOL_VERSION,
  bridgeDir,
  outboxDir,
  ensureQueue,
  writeAtomic,
  resultSchema,
  makeError,
  type JobMessage,
  type ResultMessage,
} from '@ae-mcp/protocol';
import { FileQueueTransport } from './file-queue-transport.js';
import type { Transport } from './transport.js';

const execFileAsync = promisify(execFile);

export interface RunResult {
  stdout: string;
}

export type Runner = (
  command: string,
  args: string[],
  options: { encoding: 'utf8'; timeout?: number },
) => Promise<RunResult>;

const defaultRunner: Runner = (command, args, options) =>
  execFileAsync(command, args, options) as Promise<RunResult>;

export function aeAppName(): string {
  return process.env.AE_APP_NAME ?? 'Adobe After Effects 2025';
}

/** The After Effects to script: `AE_APP_NAME`, else the newest install under
`applicationsDir`, else the default name. A fixed default left AE 2026 users on
the file-queue fallback (#179). */
export async function resolveAeAppName(applicationsDir?: string): Promise<string> {
  if (process.env.AE_APP_NAME) {
    return process.env.AE_APP_NAME;
  }
  const [newest] = await discoverAEVersions(applicationsDir);
  return newest?.appName ?? aeAppName();
}

// AE runs one script at a time. When another script (a third-party panel, or
// the startup loader) is mid-run, AE refuses a second `DoScriptFile` with a
// modal dialog and the osascript call blocks until it is dismissed. There is no
// error text to match, so bound the call: a killed call maps to AE_BUSY and the
// client retries with backoff. Observed on Mac 1 (docs/spike/third-party.md Q4).
function defaultScriptTimeoutMs(): number {
  const raw = Number(process.env.AE_MCP_SCRIPT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
}

// `DoScriptFile`/`DoScript` take an optional `override` (Contents/Resources/
// ae.sdef): "Allow one script to interrupt and run while another script is
// running." Off by default — interrupting a panel mid-operation is unsafe.
function defaultOverride(): boolean {
  return process.env.AE_MCP_SCRIPT_OVERRIDE === '1';
}

function triggerSource(payloadPath: string, jobPath: string): string {
  return `$.evalFile(${JSON.stringify(payloadPath)});\nAEMCP.processJob(${JSON.stringify(jobPath)});\n`;
}

// execFile kills the child on timeout; the rejection carries `killed`/`signal`.
function isTimeout(error: unknown): boolean {
  const e = error as { killed?: boolean; signal?: string | null } | null;
  return e?.killed === true || e?.signal === 'SIGTERM';
}

/**
 * Transport B: runs one job in the open After Effects per call via osascript
 * `DoScriptFile`. The DoScript result on macOS is `app.exitCode`, not the
 * script's last value, so the job's ResultMessage is delivered through the
 * outbox file and read back here.
 * Job files live in `jobs/`, not `inbox/`: the startup loader (transport A)
 * polls `inbox/` on a timer, so writing there would let it steal the job and
 * delete it before the trigger reads it (observed: "job is not valid JSON").
 *   https://ae-scripting.docsforadobe.dev/introduction/overview/#how-to-include-after-effects-scripting-in-an-applescript-mac-os
 *   https://ae-scripting.docsforadobe.dev/general/application/#appexitcode
 */
export class OsaScriptTransport implements Transport {
  readonly name = 'osascript' as const;
  private readonly runner: Runner;

  constructor(
    private readonly root: string,
    private readonly appName: string,
    runner?: Runner,
    private readonly timeoutMs: number = defaultScriptTimeoutMs(),
    private readonly override: boolean = defaultOverride(),
  ) {
    this.runner = runner ?? defaultRunner;
  }

  private async run(tell: string): Promise<string> {
    const { stdout } = await this.runner('osascript', ['-e', tell], {
      encoding: 'utf8',
      timeout: this.timeoutMs,
    });
    return stdout.trim();
  }

  private doScript(path: string): Promise<string> {
    const override = this.override ? ' with override' : '';
    return this.run(`tell application "${this.appName}" to DoScriptFile "${path}"${override}`);
  }

  private payloadPath(): string {
    return join(bridgeDir(this.root), 'current.jsx');
  }

  /**
   * Probes whether osascript can reach After Effects. Note: per ADR 0001,
   * transport B cold-launches AE, so this may start the app.
   * ponytail: probe launches AE if closed; gate on a running-process check when startup latency matters.
   */
  async available(): Promise<boolean> {
    const probe = join(bridgeDir(this.root), 'jobs', 'probe.jsx');
    await writeAtomic(probe, 'app.exitCode = 0;\n');
    try {
      await this.doScript(probe);
      return true;
    } catch {
      return false;
    } finally {
      await unlink(probe).catch(() => undefined);
    }
  }

  async call(job: JobMessage): Promise<ResultMessage> {
    await ensureQueue(this.root);
    const jobFile = join(bridgeDir(this.root), 'jobs', `${job.id}.json`);
    const triggerFile = join(bridgeDir(this.root), 'jobs', `${job.id}.jsx`);
    const resultFile = join(outboxDir(this.root), `${job.id}.json`);
    await writeAtomic(jobFile, JSON.stringify(job));
    await writeAtomic(triggerFile, triggerSource(this.payloadPath(), jobFile));
    try {
      await this.doScript(triggerFile);
    } catch (error) {
      await unlink(jobFile).catch(() => undefined);
      if (isTimeout(error)) {
        return {
          protocolVersion: PROTOCOL_VERSION,
          ok: false,
          error: makeError(
            'AE_BUSY',
            `After Effects did not answer within ${this.timeoutMs}ms; another script is probably running.`,
          ),
        };
      }
      return {
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: makeError('BRIDGE_NOT_LOADED', `osascript could not run the bridge: ${String(error)}`),
      };
    } finally {
      await unlink(triggerFile).catch(() => undefined);
    }
    try {
      const result = resultSchema.parse(JSON.parse(await readFile(resultFile, 'utf8')));
      await unlink(resultFile).catch(() => undefined);
      return result;
    } catch {
      return {
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: makeError('SCRIPT_ERROR', `the bridge wrote no result for job ${job.id}`),
      };
    }
  }
}

export interface SelectOptions {
  root: string;
  appName?: string;
  applicationsDir?: string;
  runner?: Runner;
}

/** Picks transport B (osascript), falling back to A (file queue) — ADR 0001. */
export async function selectTransport(options: SelectOptions): Promise<Transport> {
  const appName = options.appName ?? (await resolveAeAppName(options.applicationsDir));
  const osa = new OsaScriptTransport(options.root, appName, options.runner);
  if (await osa.available()) {
    return osa;
  }
  return new FileQueueTransport(options.root);
}