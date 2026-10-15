import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AEInstall } from '@ae-mcp/core';
import { describe, expect, it } from 'vitest';
import { createInstallerService, type InstallerServiceOptions } from './service.js';

const PAYLOAD = 'var AEMCP_BRIDGE_VERSION = "1.0.0";';
const LOADER = 'var AEMCP_LOADER = true;';
const PREFS = '[Main Pref Section v2]\n"Pref_SCRIPTING_FILE_NETWORK_SECURITY" = "0"\n';

async function createApp(applicationsDir: string, year = 2026): Promise<AEInstall> {
  const appName = `Adobe After Effects ${year}`;
  const path = join(applicationsDir, `${appName}.app`);
  await mkdir(path, { recursive: true });
  return { appName, year, path };
}

async function fakeInstall(): Promise<AEInstall> {
  return createApp(await mkdtemp(join(tmpdir(), 'ae-mcp-apps-')));
}

/** A prefs root holding one AE version folder with a Prefs.txt. */
async function fakePrefsRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ae-mcp-prefs-'));
  const dir = join(root, '26.5');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'Adobe After Effects 26.5 Prefs.txt'), PREFS);
  return root;
}

/** A temp `.mcpb` for `handMcpbToClaude`. */
async function fakeMcpb(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ae-mcp-mcpb-'));
  const path = join(dir, 'ae-mcp.mcpb');
  await writeFile(path, 'zip');
  return path;
}

/** A fake `Claude.app` so `detectEnvironment` reports Claude Desktop. */
async function fakeClaude(applicationsDir: string): Promise<void> {
  await mkdir(join(applicationsDir, 'Claude.app'), { recursive: true });
}

/** A fresh heartbeat so `runLiveTest` skips launching AE. */
async function freshHeartbeat(root: string): Promise<void> {
  await mkdir(join(root, 'bridge', 'outbox'), { recursive: true });
  await writeFile(join(root, 'bridge', 'outbox', 'heartbeat.json'), '{}');
}

function service(
  options: InstallerServiceOptions,
): ReturnType<typeof createInstallerService> {
  return createInstallerService(options);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('createInstallerService', () => {
  it('detects the environment', async () => {
    const applicationsDir = await mkdtemp(join(tmpdir(), 'ae-mcp-apps-'));
    const homeDir = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const install = await createApp(applicationsDir);

    const service = createInstallerService({
      root: join(homeDir, '.ae-mcp'),
      payload: 'x',
      loader: 'y',
      mcpbPath: 'z',
      environment: { applicationsDir, homeDir },
    });

    const environment = await service.detect();
    expect(environment.afterEffects.map((entry) => entry.path)).toEqual([install.path]);
  });

  it('repairs an explicit install and smoke-tests the bridge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const applicationsDir = await mkdtemp(join(tmpdir(), 'ae-mcp-apps-'));
    const install = await createApp(applicationsDir);
    await fakeClaude(applicationsDir);
    await freshHeartbeat(root);

    const result = await service({
      root,
      payload: PAYLOAD,
      loader: LOADER,
      mcpbPath: await fakeMcpb(),
      environment: { applicationsDir },
      prefsRoot: await fakePrefsRoot(),
      isRunning: async () => false,
      openFile: async () => true,
      call: async () => true,
    }).repair(install);

    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.check)).toEqual([
      'bridge_payload',
      'bridge_loader',
      'scripting_pref',
      'claude_extension',
      'live_test',
    ]);
    expect(await exists(join(root, 'bridge', 'current.jsx'))).toBe(true);
  });

  it('skips the live test when the Claude extension is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const applicationsDir = await mkdtemp(join(tmpdir(), 'ae-mcp-apps-'));
    const install = await createApp(applicationsDir);
    await freshHeartbeat(root);

    const result = await service({
      root,
      payload: PAYLOAD,
      loader: LOADER,
      mcpbPath: await fakeMcpb(),
      environment: { applicationsDir },
      prefsRoot: await fakePrefsRoot(),
      isRunning: async () => false,
      openFile: async () => true,
      call: async () => true,
    }).repair(install);

    expect(result.ok).toBe(false);
    expect(result.checks.map((check) => check.check)).toEqual([
      'bridge_payload',
      'bridge_loader',
      'scripting_pref',
      'claude_extension',
    ]);
    expect(result.checks.find((check) => check.check === 'claude_extension')).toMatchObject({
      status: 'fail',
    });
  });

  it('asks to quit After Effects when the pref step needs it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const install = await fakeInstall();

    const result = await service({
      root,
      payload: PAYLOAD,
      loader: LOADER,
      mcpbPath: await fakeMcpb(),
      prefsRoot: await fakePrefsRoot(),
      isRunning: async () => true,
    }).repair(install);

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.check === 'scripting_pref')).toMatchObject({
      status: 'fail',
      needsQuit: true,
    });
  });

  it('fails repair when no After Effects is found', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const applicationsDir = await mkdtemp(join(tmpdir(), 'ae-mcp-apps-'));
    const service = createInstallerService({
      root,
      payload: PAYLOAD,
      loader: LOADER,
      mcpbPath: 'z',
      environment: { applicationsDir },
    });

    const result = await service.repair();
    expect(result.ok).toBe(false);
    expect(result.checks[0].check).toBe('after_effects');
  });

  it('uninstalls an explicit install', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const applicationsDir = await mkdtemp(join(tmpdir(), 'ae-mcp-apps-'));
    const install = await createApp(applicationsDir);
    await fakeClaude(applicationsDir);
    await freshHeartbeat(root);

    const service = createInstallerService({
      root,
      payload: PAYLOAD,
      loader: LOADER,
      mcpbPath: await fakeMcpb(),
      environment: { applicationsDir },
      prefsRoot: await fakePrefsRoot(),
      isRunning: async () => false,
      openFile: async () => true,
      call: async () => true,
    });
    await service.repair(install);

    const result = await service.uninstall(install);
    expect(result).toMatchObject({ check: 'uninstall', status: 'ok' });
    expect(result.removed.length).toBe(2);
  });

  it('fails uninstall when no After Effects is found', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const applicationsDir = await mkdtemp(join(tmpdir(), 'ae-mcp-apps-'));
    const service = createInstallerService({
      root,
      payload: PAYLOAD,
      loader: LOADER,
      mcpbPath: 'z',
      environment: { applicationsDir },
    });

    const result = await service.uninstall();
    expect(result.status).toBe('fail');
    expect(result.removed).toEqual([]);
  });

  it('exports a diagnostics report', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const applicationsDir = await mkdtemp(join(tmpdir(), 'ae-mcp-apps-'));
    const install = await createApp(applicationsDir);
    const service = createInstallerService({
      root: join(homeDir, '.ae-mcp'),
      payload: PAYLOAD,
      loader: LOADER,
      mcpbPath: 'z',
      environment: { applicationsDir, homeDir },
    });

    const path = await service.diagnostics();

    expect(path).toBe(join(homeDir, 'Desktop', 'ae-mcp-diagnostics.txt'));
    const report = await readFile(path, 'utf8');
    expect(report).toContain('AE-MCP diagnostics');
    expect(report).toContain(install.path);
  });
});
