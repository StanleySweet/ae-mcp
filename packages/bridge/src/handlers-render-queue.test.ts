import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-render-queue-'));
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

function queueWithThree(ctx: vm.Context): void {
  for (const name of ['A', 'B', 'C']) {
    invoke(ctx, 'comp.create', { name, width: 800, height: 600, fps: 24, duration: 5 });
    invoke(ctx, 'render.queue_add', { comp: name });
  }
}

describe('render.queue_remove', () => {
  it('removes the item at the given index and leaves the others in order', async () => {
    const { ctx, ae } = await payloadContext();
    queueWithThree(ctx);

    const out = invoke(ctx, 'render.queue_remove', { index: 2 });

    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ removed: 1, numItems: 2 });
    expect(ae.project.renderQueue.numItems).toBe(2);
    expect(ae.project.renderQueue.item(1)?.comp.name).toBe('A');
    expect(ae.project.renderQueue.item(2)?.comp.name).toBe('C');
  });

  it('empties the queue when all is true', async () => {
    const { ctx, ae } = await payloadContext();
    queueWithThree(ctx);

    const out = invoke(ctx, 'render.queue_remove', { all: true });

    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ removed: 3, numItems: 0 });
    expect(ae.project.renderQueue.numItems).toBe(0);
  });

  it('refuses without index or all, and for an index past the queue', async () => {
    const { ctx, ae } = await payloadContext();
    queueWithThree(ctx);

    const none = invoke(ctx, 'render.queue_remove', {});
    expect(none.ok).toBe(false);
    expect(none.issue).toMatchObject({ code: 'INVALID_ARGS' });

    const past = invoke(ctx, 'render.queue_remove', { index: 9 });
    expect(past.ok).toBe(false);
    expect(past.issue).toMatchObject({ code: 'INVALID_ARGS' });
    expect(ae.project.renderQueue.numItems).toBe(3);
  });

  it('is a no-op on an empty queue with all', async () => {
    const { ctx } = await payloadContext();

    const out = invoke(ctx, 'render.queue_remove', { all: true });

    expect(out.value).toEqual({ removed: 0, numItems: 0 });
  });
});
