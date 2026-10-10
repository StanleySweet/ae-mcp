import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  PROTOCOL_VERSION,
  bridgeDir,
  inboxDir,
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
  options: { encoding: 'utf8' },
) => Promise<RunResult>;

const defaultRunner: Runner = (command, args, options) =>
  execFileAsync(command, args, options) as Promise<RunResult>;

export function aeAppName(): string {
  return process.env.AE_APP_NAME ?? 'Adobe After Effects 2025';
}

function triggerSource(payloadPath: string, jobPath: string): string {
  return `$.evalFile(${JSON.stringify(payloadPath)});\nAEMCP.processJob(${JSON.stringify(jobPath)});\n`;
}

/**
 * Transport B: runs one job in the open After Effects per call via osascript
 * `DoScriptFile`. The DoScript result on macOS is `app.exitCode`, not the
 * script's last value, so the job's ResultMessage is delivered through the
 * outbox file and read back here.
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
  ) {
    this.runner = runner ?? defaultRunner;
  }

  private async run(tell: string): Promise<string> {
    const { stdout } = await this.runner('osascript', ['-e', tell], { encoding: 'utf8' });
    return stdout.trim();
  }

  private doScript(path: string): Promise<string> {
    return this.run(`tell application "${this.appName}" to DoScriptFile "${path}"`);
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
    const jobFile = join(inboxDir(this.root), `${job.id}.json`);
    const triggerFile = join(bridgeDir(this.root), 'jobs', `${job.id}.jsx`);
    const resultFile = join(outboxDir(this.root), `${job.id}.json`);
    await writeAtomic(jobFile, JSON.stringify(job));
    await writeAtomic(triggerFile, triggerSource(this.payloadPath(), jobFile));
    try {
      await this.doScript(triggerFile);
    } catch (error) {
      await unlink(jobFile).catch(() => undefined);
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
  runner?: Runner;
}

/** Picks transport B (osascript), falling back to A (file queue) — ADR 0001. */
export async function selectTransport(options: SelectOptions): Promise<Transport> {
  const osa = new OsaScriptTransport(options.root, options.appName ?? aeAppName(), options.runner);
  if (await osa.available()) {
    return osa;
  }
  return new FileQueueTransport(options.root);
}