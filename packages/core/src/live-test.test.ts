import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { isHeartbeatFresh, runLiveTest } from './live-test.js';

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ae-mcp-live-'));
  return root;
}

async function writeHeartbeat(root: string): Promise<void> {
  const dir = join(root, 'bridge', 'outbox');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'heartbeat.json'), '{}');
}

describe('isHeartbeatFresh', () => {
  it('is true for a heartbeat written just now', async () => {
    const root = await tempRoot();
    await writeHeartbeat(root);
    expect(await isHeartbeatFresh(root, 90_000, Date.now)).toBe(true);
  });

  it('is false when the heartbeat is missing', async () => {
    expect(await isHeartbeatFresh(await tempRoot(), 90_000, Date.now)).toBe(false);
  });

  it('is false when the heartbeat is older than the window', async () => {
    const root = await tempRoot();
    await writeHeartbeat(root);
    expect(await isHeartbeatFresh(root, 90_000, () => Date.now() + 10_000_000)).toBe(false);
  });
});

describe('runLiveTest', () => {
  it('passes when AE is up and the test comp can be created then removed', async () => {
    const root = await tempRoot();
    await writeHeartbeat(root);
    const launch = vi.fn(async () => true);
    const tools: string[] = [];
    const call = vi.fn(async (tool: string) => {
      tools.push(tool);
      return true;
    });

    const result = await runLiveTest({ root, appName: 'Adobe After Effects 2026', launch, call });

    expect(result).toMatchObject({ check: 'live_test', status: 'ok' });
    expect(launch).not.toHaveBeenCalled();
    expect(tools).toEqual(['comp.create', 'project.undo']);
  });

  it('launches AE when no heartbeat is present', async () => {
    const root = await tempRoot();
    const launch = vi.fn(async () => {
      await writeHeartbeat(root);
      return true;
    });
    const call = vi.fn(async () => true);

    const result = await runLiveTest({ root, appName: 'Adobe After Effects 2026', launch, call });

    expect(result.status).toBe('ok');
    expect(launch).toHaveBeenCalledWith('Adobe After Effects 2026');
  });

  it('fails with a fix when AE cannot be launched', async () => {
    const root = await tempRoot();
    const launch = vi.fn(async () => false);
    const call = vi.fn(async () => true);

    const result = await runLiveTest({ root, appName: 'Adobe After Effects 2026', launch, call });

    expect(result.status).toBe('fail');
    expect(result.fix).toBeTruthy();
    expect(call).not.toHaveBeenCalled();
  });

  it('fails when the heartbeat never arrives', async () => {
    const root = await tempRoot();
    const launch = vi.fn(async () => true);
    const call = vi.fn(async () => true);

    const result = await runLiveTest({
      root,
      appName: 'Adobe After Effects 2026',
      launch,
      call,
      timeoutMs: 0,
    });

    expect(result.status).toBe('fail');
    expect(result.fix).toBeTruthy();
    expect(call).not.toHaveBeenCalled();
  });

  it('fails when the test comp cannot be created', async () => {
    const root = await tempRoot();
    await writeHeartbeat(root);
    const call = vi.fn(async () => false);

    const result = await runLiveTest({ root, appName: 'Adobe After Effects 2026', call });

    expect(result.status).toBe('fail');
    expect(result.fix).toBeTruthy();
  });

  it('fails when the test comp cannot be removed', async () => {
    const root = await tempRoot();
    await writeHeartbeat(root);
    const call = vi.fn(async (tool: string) => tool === 'comp.create');

    const result = await runLiveTest({ root, appName: 'Adobe After Effects 2026', call });

    expect(result.status).toBe('fail');
    expect(result.fix).toBeTruthy();
  });
});
