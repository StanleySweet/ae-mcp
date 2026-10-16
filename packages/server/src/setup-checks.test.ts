import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { outboxDir } from '@ae-mcp/protocol';
import { describe, it, expect } from 'vitest';
import { runSetupChecks } from './setup-checks.js';

async function fakeApplications(...names: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ae-mcp-setup-apps-'));
  for (const name of names) {
    await mkdir(join(dir, name), { recursive: true });
  }
  return dir;
}

async function queueRoot(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-setup-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  return root;
}

async function writeHeartbeat(root: string, capabilities: string[] = []): Promise<string> {
  await mkdir(outboxDir(root), { recursive: true, mode: 0o700 });
  const file = join(outboxDir(root), 'heartbeat.json');
  await writeFile(
    file,
    JSON.stringify({
      protocolVersion: 1,
      bridgeVersion: '0.0.0',
      aeVersion: '26.5',
      os: 'Macintosh',
      capabilities,
      busy: false,
      transport: 'osascript',
    }),
  );
  return file;
}

async function writeSavedVersion(root: string, path: string): Promise<void> {
  await mkdir(join(root, 'bridge'), { recursive: true, mode: 0o700 });
  await writeFile(join(root, 'bridge', 'last-saved-version'), path);
}

function statusOf(checks: { check: string; status: string }[], name: string): string | undefined {
  return checks.find((c) => c.check === name)?.status;
}

describe('runSetupChecks', () => {
  it('reports every check ok when AE and the bridge are ready', async () => {
    const root = await queueRoot();
    await writeHeartbeat(root);
    const savedFile = join(await mkdtemp(join(tmpdir(), 'ae-mcp-saved-')), 'P_v008.aep');
    await writeFile(savedFile, '');
    await writeSavedVersion(root, savedFile);
    const checks = await runSetupChecks({
      root,
      applicationsDir: await fakeApplications('Adobe After Effects 2026.app'),
    });
    expect(checks.map((c) => c.check)).toEqual([
      'after_effects',
      'bridge_heartbeat',
      'bridge_capabilities',
      'queue_permissions',
      'project_saved_version',
      'third_party_extensions',
    ]);
    expect(checks.every((c) => c.status === 'ok')).toBe(true);
  });

  it('lists detected CEP extensions from the user folder', async () => {
    const root = await queueRoot();
    await writeHeartbeat(root);
    const home = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const extDir = join(home, 'Library/Application Support/Adobe/CEP/extensions');
    await mkdir(join(extDir, 'com.misterhorse.animationcomposer'), { recursive: true });
    await mkdir(join(extDir, 'com.mtmograph.motion'), { recursive: true });
    const checks = await runSetupChecks({
      root,
      applicationsDir: await fakeApplications('Adobe After Effects 2026.app'),
      homeDir: home,
    });
    expect(statusOf(checks, 'third_party_extensions')).toBe('ok');
    const detail = checks.find((c) => c.check === 'third_party_extensions')?.detail ?? '';
    expect(detail).toContain('com.misterhorse.animationcomposer');
    expect(detail).toContain('com.mtmograph.motion');
  });

  it('fails after_effects with a fix when no supported AE is installed', async () => {
    const root = await queueRoot();
    await writeHeartbeat(root);
    const checks = await runSetupChecks({
      root,
      applicationsDir: await fakeApplications('Adobe After Effects 2024.app'),
    });
    expect(statusOf(checks, 'after_effects')).toBe('fail');
    expect(checks.find((c) => c.check === 'after_effects')?.fix).toMatch(/Install After Effects/);
  });

  it('fails bridge_heartbeat when no heartbeat exists', async () => {
    const root = await queueRoot();
    const checks = await runSetupChecks({
      root,
      applicationsDir: await fakeApplications('Adobe After Effects 2026.app'),
    });
    expect(statusOf(checks, 'bridge_heartbeat')).toBe('fail');
  });

  it('fails bridge_heartbeat when the heartbeat is stale', async () => {
    const root = await queueRoot();
    const file = await writeHeartbeat(root);
    const old = new Date(Date.now() - 5 * 60_000);
    await utimes(file, old, old);
    const checks = await runSetupChecks({
      root,
      applicationsDir: await fakeApplications('Adobe After Effects 2026.app'),
    });
    expect(statusOf(checks, 'bridge_heartbeat')).toBe('fail');
  });

  it('fails bridge_capabilities when the installed payload misses operations the server knows', async () => {
    const root = await queueRoot();
    await writeHeartbeat(root, ['project.info', 'comp.create']);
    const checks = await runSetupChecks({
      root,
      applicationsDir: await fakeApplications('Adobe After Effects 2026.app'),
      expectedOperations: ['project.info', 'comp.create', 'expression.snippet', 'rig.null_controller'],
    });
    expect(statusOf(checks, 'bridge_capabilities')).toBe('fail');
    const fix = checks.find((c) => c.check === 'bridge_capabilities')?.fix ?? '';
    expect(fix).toContain('expression.snippet');
    expect(fix).toMatch(/Refresh the bridge/);
  });

  it('passes bridge_capabilities when the payload reports every expected operation', async () => {
    const root = await queueRoot();
    await writeHeartbeat(root, ['project.info', 'comp.create', 'ae_version_info']);
    const checks = await runSetupChecks({
      root,
      applicationsDir: await fakeApplications('Adobe After Effects 2026.app'),
      expectedOperations: ['project.info', 'comp.create'],
    });
    expect(statusOf(checks, 'bridge_capabilities')).toBe('ok');
  });

  it('fails queue_permissions when the queue is not 0700', async () => {
    const root = await queueRoot();
    await writeHeartbeat(root);
    await chmod(root, 0o755);
    const checks = await runSetupChecks({
      root,
      applicationsDir: await fakeApplications('Adobe After Effects 2026.app'),
    });
    expect(statusOf(checks, 'queue_permissions')).toBe('fail');
  });

  it('fails project_saved_version when no saved version file exists', async () => {
    const root = await queueRoot();
    await writeHeartbeat(root);
    const checks = await runSetupChecks({
      root,
      applicationsDir: await fakeApplications('Adobe After Effects 2026.app'),
    });
    expect(statusOf(checks, 'project_saved_version')).toBe('fail');
    expect(checks.find((c) => c.check === 'project_saved_version')?.fix).toMatch(
      /never been saved/,
    );
  });

  it('fails project_saved_version when the saved version no longer exists on disk', async () => {
    const root = await queueRoot();
    await writeHeartbeat(root);
    await writeSavedVersion(root, '/projects/P_v008.aep');
    await rm('/projects/P_v008.aep', { force: true });
    const checks = await runSetupChecks({
      root,
      applicationsDir: await fakeApplications('Adobe After Effects 2026.app'),
    });
    expect(statusOf(checks, 'project_saved_version')).toBe('fail');
    expect(checks.find((c) => c.check === 'project_saved_version')?.fix).toMatch(
      /no longer exists/,
    );
  });
});