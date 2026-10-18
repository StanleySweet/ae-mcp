import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, parse } from 'node:path';
import type { BackupMode } from './settings.js';

/** Where the backups of one project live: `<root>/backups/<project name>/`, never next to the project (ADR-0012). */
export function backupFolder(root: string, savedFile: string): string {
  return join(root, 'backups', parse(savedFile).name);
}

/** Local time as YYYYMMDD-HHMMSS, the stamp in increment backup names. */
export function backupStamp(now: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}` +
    `-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Deletes the oldest increment backups of one project so that `keep` newest remain. */
async function pruneIncrements(folder: string, name: string, keep: number): Promise<void> {
  const pattern = new RegExp(`^${escapeRegExp(name)}-(\\d{8}-\\d{6})(?:-(\\d+))?\\.aep$`);
  const entries = (await readdir(folder))
    .map((file) => ({ file, match: pattern.exec(file) }))
    .filter((entry): entry is { file: string; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => ({
      file: entry.file,
      key: `${entry.match[1]}-${String(Number(entry.match[2] ?? '1')).padStart(6, '0')}`,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const stale of entries.slice(0, Math.max(0, entries.length - keep))) {
    // An old backup that cannot be removed must not block the operation the user asked for.
    await rm(join(folder, stale.file), { force: true }).catch(() => undefined);
  }
}

/**
 * Copies the project file the bridge just saved into the backup folder.
 * `single` overwrites `<name>.backup.aep`; `increment` writes `<name>-YYYYMMDD-HHMMSS.aep`
 * and keeps the newest `keep` of them. Returns the backup path, or null when mode is off.
 */
export async function copyToBackups(
  root: string,
  savedFile: string,
  mode: BackupMode,
  keep: number,
  now: Date = new Date(),
): Promise<string | null> {
  if (mode === 'off') {
    return null;
  }
  const name = parse(savedFile).name;
  const folder = backupFolder(root, savedFile);
  await mkdir(folder, { recursive: true, mode: 0o700 });

  if (mode === 'single') {
    const target = join(folder, `${name}.backup.aep`);
    await copyFile(savedFile, target);
    return target;
  }

  const base = `${name}-${backupStamp(now)}`;
  let target = join(folder, `${base}.aep`);
  for (let n = 2; await exists(target); n++) {
    target = join(folder, `${base}-${n}.aep`);
  }
  await copyFile(savedFile, target);
  await pruneIncrements(folder, name, keep);
  return target;
}
