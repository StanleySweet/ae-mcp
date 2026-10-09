import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { nextId, spikeRoot } from './inbox.js';

const execFileAsync = promisify(execFile);

export function aeAppName(): string {
  return process.env.AE_APP_NAME ?? 'Adobe After Effects 2025';
}

export interface RunResult {
  stdout: string;
  stderr?: string;
}

export type Runner = (command: string, args: string[], options: { encoding: string }) => Promise<RunResult>;

const defaultRunner: Runner = (command, args, options) =>
  execFileAsync(command, args, options) as Promise<RunResult>;

/**
 * Transport B: run one ExtendScript file in After Effects per call via
 * osascript `DoScriptFile`.
 *   https://ae-scripting.docsforadobe.dev/introduction/overview/#how-to-include-after-effects-scripting-in-an-applescript-mac-os
 */
export function createOsaScriptDispatcher(
  runner: Runner = defaultRunner,
  appName: string = aeAppName(),
): { evalScript(body: string): Promise<string> } {
  return {
    async evalScript(body) {
      const jobFile = join(spikeRoot(), 'jobs', `${nextId()}.jsx`);
      mkdirSync(dirname(jobFile), { recursive: true, mode: 0o700 });
      writeFileSync(jobFile, body, { mode: 0o600 });
      try {
        const { stdout } = await runner('osascript', [
          '-e',
          `tell application "${appName}" to DoScriptFile "${jobFile}"`,
        ], { encoding: 'utf8' });
        return stdout.trim();
      } finally {
        rmSync(jobFile, { force: true });
      }
    },
  };
}