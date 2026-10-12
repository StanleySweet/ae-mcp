import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { AEInstall } from './ae-discovery.js';
import { repairAeMcp, uninstallAeMcp } from './repair-uninstall.js';

const PAYLOAD = 'var AEMCP_BRIDGE_VERSION = "1.0.0";';
const LOADER = 'var AEMCP_LOADER = true;';

async function fakeInstall(): Promise<{ install: AEInstall; folder: string }> {
  const folder = await mkdtemp(join(tmpdir(), 'ae-mcp-ae-'));
  const appName = 'Adobe After Effects 2026';
  const appPath = join(folder, `${appName}.app`);
  await mkdir(appPath, { recursive: true });
  return { install: { appName, year: 2026, path: appPath }, folder };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('repairAeMcp', () => {
  it('reinstalls the payload and the loader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const { install, folder } = await fakeInstall();

    const result = await repairAeMcp({ root, install, payload: PAYLOAD, loader: LOADER });

    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => [check.check, check.status])).toEqual([
      ['bridge_payload', 'ok'],
      ['bridge_loader', 'ok'],
    ]);
    expect(await readFile(join(root, 'bridge', 'current.jsx'), 'utf8')).toBe(PAYLOAD);
    expect(await readFile(join(folder, 'Scripts', 'Startup', 'ae-mcp-loader.jsx'), 'utf8')).toBe(
      LOADER,
    );
  });

  it('reports ok=false when a step fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const { install, folder } = await fakeInstall();
    await writeFile(join(folder, 'Scripts'), 'blocked');

    const result = await repairAeMcp({ root, install, payload: PAYLOAD, loader: LOADER });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.check === 'bridge_loader')?.status).toBe('fail');
  });
});

describe('uninstallAeMcp', () => {
  it('removes the installed payload, bridge folder and loader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const { install, folder } = await fakeInstall();
    await repairAeMcp({ root, install, payload: PAYLOAD, loader: LOADER });

    const result = await uninstallAeMcp({ root, install });

    expect(result).toMatchObject({ check: 'uninstall', status: 'ok' });
    expect(result.removed.length).toBe(2);
    expect(await exists(join(root, 'bridge'))).toBe(false);
    expect(await exists(join(folder, 'Scripts', 'Startup', 'ae-mcp-loader.jsx'))).toBe(false);
  });

  it('is idempotent when nothing is installed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const { install } = await fakeInstall();

    const result = await uninstallAeMcp({ root, install });

    expect(result).toMatchObject({ status: 'ok', removed: [] });
  });
});
