import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, runInMockAE } from './mock-ae.js';

const DO_NOT_SAVE_CHANGES = 1612;

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-project-new-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: unknown; issue?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

describe('project.new', () => {
  it('refuses while the open project has unsaved changes', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
    ae.project.dirty = true;

    const out = invoke(ctx, 'project.new', {});

    expect(out.ok).toBe(false);
    expect(out.issue).toMatchObject({
      code: 'INVALID_ARGS',
      message: 'the open project has unsaved changes: save it or pass force: true',
    });
    expect(ae.project.numItems).toBe(1);
    expect(ae.project.closed).toEqual([]);
  });

  it('creates an empty project when the open one is clean', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
    ae.project.dirty = false;

    const out = invoke(ctx, 'project.new', {});

    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ numItems: 0 });
    expect(ae.project.numItems).toBe(0);
    expect(ae.project.closed).toEqual([]);
  });

  it('discards unsaved changes without a prompt when force is true', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
    ae.project.dirty = true;

    const out = invoke(ctx, 'project.new', { force: true });

    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ numItems: 0 });
    expect(ae.project.closed).toEqual([DO_NOT_SAVE_CHANGES]);
    expect(ae.project.numItems).toBe(0);
    expect(ae.project.dirty).toBe(false);
  });

  // A fresh AE's untitled project reports dirty = true; nothing to protect (#224).
  it('replaces an empty untitled project even when it reports unsaved changes', async () => {
    const { ctx, ae } = await payloadContext();
    ae.project.file = null;
    ae.project.dirty = true;

    const out = invoke(ctx, 'project.new', {});

    expect(out.ok).toBe(true);
  });
});
