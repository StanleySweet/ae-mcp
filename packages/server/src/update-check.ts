import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { clearTimeout } from 'node:timers';

/** Set to 1 to turn the extension update check off entirely. */
export const UPDATE_CHECK_ENV = 'AE_MCP_NO_UPDATE_CHECK';

const LATEST_RELEASE_URL = 'https://api.github.com/repos/StanleySweet/ae-mcp/releases/latest';
const CACHE_FILE = 'update-check.json';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 3000;

export interface ReleaseInfo {
  /** The release tag, for example `v1.5.0`. */
  version: string;
  url: string;
}

export interface UpdateCheckOptions {
  /** Queue root (`~/.ae-mcp`); the lookup is cached in `update-check.json` here. */
  root: string;
  /** The running server version, for example `1.4.1`. */
  current: string;
  /** Environment to read the opt-out from; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Release source (test seam). Defaults to the GitHub latest-release API. */
  fetchLatest?: (signal: AbortSignal) => Promise<ReleaseInfo>;
  now?: () => number;
  timeoutMs?: number;
}

export type UpdateCheckResult =
  | { status: 'disabled' }
  | { status: 'up_to_date'; latest: string }
  | { status: 'update_available'; latest: string; url: string }
  | { status: 'unavailable'; reason: string };

interface CacheEntry extends ReleaseInfo {
  checkedAt: number;
}

async function fetchLatestRelease(signal: AbortSignal): Promise<ReleaseInfo> {
  const response = await globalThis.fetch(LATEST_RELEASE_URL, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'ae-mcp' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
  if (typeof body.tag_name !== 'string' || typeof body.html_url !== 'string') {
    throw new Error('unexpected release payload');
  }
  return { version: body.tag_name, url: body.html_url };
}

async function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function readCache(root: string): Promise<CacheEntry | null> {
  try {
    const parsed = JSON.parse(await readFile(join(root, CACHE_FILE), 'utf8')) as Partial<CacheEntry>;
    if (typeof parsed.checkedAt === 'number' && typeof parsed.version === 'string' && typeof parsed.url === 'string') {
      return { checkedAt: parsed.checkedAt, version: parsed.version, url: parsed.url };
    }
    return null;
  } catch {
    return null;
  }
}

async function writeCache(root: string, entry: CacheEntry): Promise<void> {
  try {
    await writeFile(join(root, CACHE_FILE), JSON.stringify(entry));
  } catch {
    // A cache that cannot be written only means the next check looks again.
  }
}

/** Parses `v1.2.3` or `1.2.3` into numbers, or null when it is not a release number. */
function parseVersion(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (match === null) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewer(latest: string, current: string): boolean | null {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (a === null || b === null) {
    return null;
  }
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) {
      return a[i]! > b[i]!;
    }
  }
  return false;
}

/**
 * Compares the running server with the latest GitHub release. Uses a cache for a
 * day; a failed lookup falls back to an older cached release, or reports
 * `unavailable`. Never throws.
 */
export async function checkForUpdate(options: UpdateCheckOptions): Promise<UpdateCheckResult> {
  const env = options.env ?? process.env;
  if (env[UPDATE_CHECK_ENV] === '1') {
    return { status: 'disabled' };
  }
  const now = options.now ?? Date.now;
  const cached = await readCache(options.root);
  let release: ReleaseInfo;
  if (cached !== null && now() - cached.checkedAt < CACHE_MAX_AGE_MS) {
    release = cached;
  } else {
    const fetchLatest = options.fetchLatest ?? fetchLatestRelease;
    try {
      release = await withTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, fetchLatest);
      await writeCache(options.root, { ...release, checkedAt: now() });
    } catch (error) {
      if (cached === null) {
        return {
          status: 'unavailable',
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      release = cached;
    }
  }
  const newer = isNewer(release.version, options.current);
  if (newer === null) {
    return { status: 'unavailable', reason: `unrecognized release version ${release.version}` };
  }
  if (newer) {
    return { status: 'update_available', latest: release.version, url: release.url };
  }
  return { status: 'up_to_date', latest: release.version };
}
