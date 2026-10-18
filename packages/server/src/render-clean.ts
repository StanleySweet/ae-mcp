import { lstat, readdir, realpath, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** One file render_clean would delete, relative to `<root>/render`. */
export interface RenderCleanFile {
  path: string;
  bytes: number;
  ageMinutes: number;
}

export interface RenderCleanResult {
  dryRun: boolean;
  renderDir: string;
  matched: RenderCleanFile[];
  deleted: string[];
  /** Entries that were not files (symlinks, folders) and so were left alone. */
  skipped: string[];
}

export interface RenderCleanOptions {
  root: string;
  olderThanMinutes?: number;
  /** Shell-style wildcard on the file name: `*` any run, `?` one character. Case-sensitive. */
  pattern?: string;
  /** Default true: list what would go and delete nothing. */
  dryRun?: boolean;
  /** Clock override for tests. */
  now?: number;
}

/** A file-name wildcard (`*`, `?`) as an anchored regular expression; every other character is literal. */
export function wildcardToRegExp(pattern: string): RegExp {
  let source = '';
  for (const ch of pattern) {
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else source += ch.replace(/[.+^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp('^' + source + '$');
}

/**
 * Lists, and with dryRun false deletes, files that ae-mcp rendered under `<root>/render`.
 * Only regular files inside that folder are candidates: symlinks and folders are never
 * followed or removed, and a path that resolves outside the folder is refused (#E16-6).
 */
export async function renderClean(options: RenderCleanOptions): Promise<RenderCleanResult> {
  const dryRun = options.dryRun !== false;
  const now = options.now ?? Date.now();
  const renderDir = resolve(options.root, 'render');
  const result: RenderCleanResult = { dryRun, renderDir, matched: [], deleted: [], skipped: [] };

  let realRender: string;
  try {
    realRender = await realpath(renderDir);
  } catch {
    return result; // no render folder yet: nothing to clean
  }
  const rootLink = await lstat(renderDir);
  if (rootLink.isSymbolicLink()) {
    throw new Error(`refusing to clean: ${renderDir} is a symbolic link`);
  }

  const matcher = options.pattern !== undefined && options.pattern !== '' ? wildcardToRegExp(options.pattern) : null;
  const cutoff = options.olderThanMinutes !== undefined ? now - options.olderThanMinutes * 60_000 : null;

  const files = await listFiles(renderDir, '', result.skipped);
  for (const rel of files) {
    const name = rel.split(sep).pop() ?? rel;
    if (matcher && !matcher.test(name)) continue;
    const full = resolve(renderDir, rel);
    if (!isInside(realRender, await realpath(full))) {
      result.skipped.push(rel);
      continue;
    }
    const info = await stat(full);
    if (cutoff !== null && info.mtimeMs > cutoff) continue;
    result.matched.push({
      path: rel,
      bytes: info.size,
      ageMinutes: Math.round((now - info.mtimeMs) / 60_000),
    });
  }

  if (!dryRun) {
    for (const file of result.matched) {
      await rm(join(renderDir, file.path), { force: true });
      result.deleted.push(file.path);
    }
  }
  return result;
}

/** Regular files under `dir` (relative paths), descending into real folders only. */
async function listFiles(dir: string, prefix: string, skipped: string[]): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(join(dir, prefix), { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : join(prefix, entry.name);
    if (entry.isSymbolicLink()) {
      skipped.push(rel);
    } else if (entry.isDirectory()) {
      out.push(...(await listFiles(dir, rel, skipped)));
    } else if (entry.isFile()) {
      out.push(rel);
    } else {
      skipped.push(rel);
    }
  }
  return out;
}

/** True when `target` is a path strictly inside `folder` (both already resolved). */
function isInside(folder: string, target: string): boolean {
  const rel = relative(folder, target);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}
