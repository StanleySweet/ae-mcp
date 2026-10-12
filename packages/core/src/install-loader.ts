import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { AEInstall } from './ae-discovery.js';
import type { InstallerCheck } from './install-payload.js';

const execFileAsync = promisify(execFile);

export const LOADER_FILE_NAME = 'ae-mcp-loader.jsx';

/** Writes `contents` to `path` with administrator rights. Returns success. */
export type ElevatedWrite = (path: string, contents: string) => Promise<boolean>;

/** `<AE app folder>/Scripts/Startup` — where After Effects runs startup scripts. */
export function loaderStartupDir(install: AEInstall): string {
  return join(dirname(install.path), 'Scripts', 'Startup');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Shell command that copies `source` to `dest`, creating `dest`'s folder. */
export function elevatedCopyCommand(source: string, dest: string): string {
  return `mkdir -p ${shellQuote(dirname(dest))} && cp ${shellQuote(source)} ${shellQuote(dest)}`;
}

/**
 * Default {@link ElevatedWrite}: stages the file in a temp dir, then copies it
 * into place with `osascript ... with administrator privileges` (macOS).
 */
export async function osascriptElevatedWrite(path: string, contents: string): Promise<boolean> {
  const staging = await mkdtemp(join(tmpdir(), 'ae-mcp-elevate-'));
  const source = join(staging, 'ae-mcp-loader.jsx');
  await writeFile(source, contents);
  const script = `do shell script ${JSON.stringify(elevatedCopyCommand(source, path))} with administrator privileges`;
  try {
    await execFileAsync('osascript', ['-e', script]);
    return true;
  } catch {
    return false;
  }
}

export interface InstallLoaderOptions {
  install: AEInstall;
  loader: string;
  fileName?: string;
  /** Admin-write seam; defaults to {@link osascriptElevatedWrite}. */
  elevatedWrite?: ElevatedWrite;
}

export interface InstallLoaderResult extends InstallerCheck {
  changed: boolean;
  path: string;
  /** Human-readable instructions for installing the loader by hand. */
  manual?: string;
}

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
}

function manualInstructions(path: string): string {
  return [
    `Setup could not write ${path}.`,
    'Approve the administrator prompt, or install the loader by hand:',
    'open the folder above in Finder (Go > Go to Folder),',
    'copy ae-mcp-loader.jsx there, then quit and reopen After Effects.',
  ].join(' ');
}

/**
 * Installs the startup loader at `<AE folder>/Scripts/Startup`, writing directly
 * when allowed and retrying with admin elevation on a permission error. Returns
 * a `{check, status, fix}` row; a manual fallback string accompanies failures.
 */
export async function installLoader(
  options: InstallLoaderOptions,
): Promise<InstallLoaderResult> {
  const path = join(loaderStartupDir(options.install), options.fileName ?? LOADER_FILE_NAME);
  const previous = await readFile(path, 'utf8').catch(() => null);
  if (previous === options.loader) {
    return { check: 'bridge_loader', status: 'ok', changed: false, path };
  }
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, options.loader);
    return { check: 'bridge_loader', status: 'ok', changed: true, path };
  } catch (error) {
    if (isPermissionError(error)) {
      const elevate = options.elevatedWrite ?? osascriptElevatedWrite;
      if (await elevate(path, options.loader)) {
        return { check: 'bridge_loader', status: 'ok', changed: true, path };
      }
    }
    return {
      check: 'bridge_loader',
      status: 'fail',
      changed: false,
      path,
      fix: `Install the loader at ${path} with an administrator, then reopen After Effects.`,
      manual: manualInstructions(path),
    };
  }
}
