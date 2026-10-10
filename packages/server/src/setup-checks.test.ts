import { chmod, mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
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

async function writeHeartbeat(root: string): Promise<string> {
  await mkdir(outboxDir(root), { recursive: true, mode: 0o700 });
  const file = join(outboxDir(root), 'heartbeat.json');
  await writeFile(
    file,
    JSON.stringify({
      protocolVersion: 1,
      bridgeVersion: '0.0.0',
      aeVersion: '26.5',
      os: 'Macintosh',
      capabilities: [],
      busy: false,
      transport: 'osascript',
    }),
  );
  return file;
}

function statusOf(checks: { check: string; status: string }[], name: string): string | undefined {
  return checks.find((c) => c.check === name)?.status;
}

describe('runSetupChecks', () => {
  it('reports every check ok when AE and the bridge are ready', async () => {
    const root = await queueRoot();
    await writeHeartbeat(root);
    const checks = await runSetupChecks({
      root,
      applicationsDir: await fakeApplications('Adobe After Effects 2026.app'),
    });
    expect(checks.map((c) => c.check)).toEqual([
      'after_effects',
      'bridge_heartbeat',
      'queue_permissions',
    ]);
    expect(checks.every((c) => c.status === 'ok')).toBe(true);
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
});