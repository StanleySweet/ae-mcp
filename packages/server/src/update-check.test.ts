import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { runSetupChecks } from './setup-checks.js';
import { checkForUpdate, type ReleaseInfo } from './update-check.js';

const RELEASE_URL = 'https://github.com/StanleySweet/ae-mcp/releases/tag/v1.5.0';

async function rootDir(): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), 'ae-mcp-update-')), '.ae-mcp');
  await mkdir(root, { recursive: true });
  return root;
}

function release(version: string): (signal: AbortSignal) => Promise<ReleaseInfo> {
  return async () => ({ version, url: RELEASE_URL });
}

describe('checkForUpdate', () => {
  it('reports up to date when the latest release is not newer', async () => {
    const root = await rootDir();
    const result = await checkForUpdate({ root, current: '1.4.1', fetchLatest: release('v1.4.1'), env: {} });
    expect(result).toEqual({ status: 'up_to_date', latest: 'v1.4.1' });
  });

  it('reports update available with the release URL when a newer release exists', async () => {
    const root = await rootDir();
    const result = await checkForUpdate({ root, current: '1.4.1', fetchLatest: release('v1.5.0'), env: {} });
    expect(result).toEqual({ status: 'update_available', latest: 'v1.5.0', url: RELEASE_URL });
  });

  it('compares numerically, so 1.10.0 is newer than 1.9.0', async () => {
    const root = await rootDir();
    const result = await checkForUpdate({ root, current: '1.9.0', fetchLatest: release('v1.10.0'), env: {} });
    expect(result.status).toBe('update_available');
  });

  it('reports unavailable when offline, without throwing', async () => {
    const root = await rootDir();
    const result = await checkForUpdate({
      root,
      current: '1.4.1',
      env: {},
      fetchLatest: async () => {
        throw new Error('getaddrinfo ENOTFOUND api.github.com');
      },
    });
    expect(result.status).toBe('unavailable');
  });

  it('does nothing when AE_MCP_NO_UPDATE_CHECK=1: no fetch and no cache write', async () => {
    const root = await rootDir();
    const fetchLatest = vi.fn(release('v9.9.9'));
    const result = await checkForUpdate({
      root,
      current: '1.4.1',
      env: { AE_MCP_NO_UPDATE_CHECK: '1' },
      fetchLatest,
    });
    expect(result).toEqual({ status: 'disabled' });
    expect(fetchLatest).not.toHaveBeenCalled();
    await expect(readFile(join(root, 'update-check.json'), 'utf8')).rejects.toThrow();
  });

  it('caches the lookup under the queue root and skips the network while fresh', async () => {
    const root = await rootDir();
    const fetchLatest = vi.fn(release('v1.5.0'));
    let now = 1_000_000;
    const options = { root, current: '1.4.1', env: {}, fetchLatest, now: () => now };

    await checkForUpdate(options);
    now += 60 * 60 * 1000;
    const second = await checkForUpdate(options);

    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(second.status).toBe('update_available');
    const cache = JSON.parse(await readFile(join(root, 'update-check.json'), 'utf8')) as Record<string, unknown>;
    expect(cache).toMatchObject({ version: 'v1.5.0', url: RELEASE_URL });
  });

  it('looks again once the cache is older than a day', async () => {
    const root = await rootDir();
    await writeFile(
      join(root, 'update-check.json'),
      JSON.stringify({ checkedAt: 0, version: 'v1.4.1', url: RELEASE_URL }),
    );
    const fetchLatest = vi.fn(release('v1.5.0'));
    const result = await checkForUpdate({
      root,
      current: '1.4.1',
      env: {},
      fetchLatest,
      now: () => 25 * 60 * 60 * 1000,
    });
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('update_available');
  });

  it('falls back to an old cached release when the lookup fails', async () => {
    const root = await rootDir();
    await writeFile(
      join(root, 'update-check.json'),
      JSON.stringify({ checkedAt: 0, version: 'v1.5.0', url: RELEASE_URL }),
    );
    const result = await checkForUpdate({
      root,
      current: '1.4.1',
      env: {},
      now: () => 48 * 60 * 60 * 1000,
      fetchLatest: async () => {
        throw new Error('offline');
      },
    });
    expect(result).toEqual({ status: 'update_available', latest: 'v1.5.0', url: RELEASE_URL });
  });
});

describe('runSetupChecks update check', () => {
  async function checksWith(options: {
    fetchLatest?: (signal: AbortSignal) => Promise<ReleaseInfo>;
    env?: Record<string, string>;
  }) {
    return runSetupChecks({
      root: await rootDir(),
      applicationsDir: await mkdtemp(join(tmpdir(), 'ae-mcp-update-apps-')),
      serverVersion: '1.4.1',
      updateCheck: { env: options.env ?? {}, fetchLatest: options.fetchLatest },
    });
  }

  it('adds an ok extension_update row that names the release URL when an update exists', async () => {
    const checks = await checksWith({ fetchLatest: release('v1.5.0') });
    const row = checks.find((c) => c.check === 'extension_update');
    expect(row?.status).toBe('ok');
    expect(row?.detail).toContain('update available');
    expect(row?.detail).toContain(RELEASE_URL);
  });

  it('never fails check_setup when offline', async () => {
    const checks = await checksWith({
      fetchLatest: async () => {
        throw new Error('offline');
      },
    });
    const row = checks.find((c) => c.check === 'extension_update');
    expect(row?.status).toBe('ok');
    expect(checks.some((c) => c.status === 'fail' && c.check === 'extension_update')).toBe(false);
  });

  it('omits the row entirely when opted out, and never calls the release source', async () => {
    const fetchLatest = vi.fn(release('v9.9.9'));
    const checks = await checksWith({ fetchLatest, env: { AE_MCP_NO_UPDATE_CHECK: '1' } });
    expect(checks.find((c) => c.check === 'extension_update')).toBeUndefined();
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it('skips the update check when no server version is given', async () => {
    const root = await rootDir();
    const fetchLatest = vi.fn(release('v9.9.9'));
    const checks = await runSetupChecks({
      root,
      applicationsDir: await mkdtemp(join(tmpdir(), 'ae-mcp-update-apps-')),
      updateCheck: { fetchLatest, env: {} },
    });
    expect(checks.find((c) => c.check === 'extension_update')).toBeUndefined();
    expect(fetchLatest).not.toHaveBeenCalled();
  });
});
