import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-rtemplates-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

interface Outcome {
  ok: boolean;
  value?: Record<string, unknown>;
  issue?: { code: string; message: string };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): Outcome {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx) as Outcome;
}

function seedComp(ae: MockAE, name: string): MockCompItem {
  const comp = new MockCompItem(ae.project.numItems + 1, name, 1920, 1080, 25, 10);
  ae.project.add(comp);
  return comp;
}

describe('render.templates', () => {
  it('returns the output module and render settings template names', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, 'Main');
    const outcome = invoke(ctx, 'render.templates', {});
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toEqual({
      outputModule: ['PNG Sequence', 'Lossless'],
      renderSettings: ['Best Settings', 'Draft Settings'],
    });
  });

  it('removes the temporary render queue item and never renders', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, 'Main');
    invoke(ctx, 'render.templates', {});
    expect(ae.project.renderQueue.numItems).toBe(1);
    expect(ae.project.renderQueue.item(1)?.removed).toBe(true);
    expect(ae.project.renderQueue.item(1)?.rendered).toBe(false);
    expect(ae.project.renderQueue.rendering).toBe(false);
  });

  it('uses the named comp, and reports a missing comp as INVALID_ARGS', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, 'Main');
    const other = seedComp(ae, 'Other');
    expect(invoke(ctx, 'render.templates', { comp: 'Other' }).ok).toBe(true);
    expect(ae.project.renderQueue.item(1)?.comp).toBe(other);
    const missing = invoke(ctx, 'render.templates', { comp: 'Nope' });
    expect(missing.ok).toBe(false);
    expect(missing.issue?.code).toBe('INVALID_ARGS');
  });

  it('reports INVALID_ARGS when the project has no comp', async () => {
    const { ctx } = await payloadContext();
    const outcome = invoke(ctx, 'render.templates', {});
    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
    expect(outcome.issue?.message).toContain('no composition');
  });
});
