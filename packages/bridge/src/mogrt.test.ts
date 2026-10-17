import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, runInMockAE } from './mock-ae.js';

interface Outcome {
  ok: boolean;
  value?: Record<string, unknown>;
  issue?: { code: string; message: string };
}

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-mogrt-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): Outcome {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

function seedHero(ae: MockAE): MockCompItem {
  const comp = new MockCompItem(1, 'Hero', 1920, 1080, 25, 10);
  ae.project.add(comp);
  ae.project.activeItem = comp;
  comp.layers.addSolid([1, 0, 0], 'Card', 1920, 1080, 1, 10);
  return comp;
}

describe('mogrt.export', () => {
  it('refuses a path that already exists unless overwrite is true', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedHero(ae);
    ae.fs.set('/out/Hero.mogrt', '');

    const outcome = invoke(ctx, 'mogrt.export', { comp: 'Hero', path: '/out/Hero.mogrt' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
    expect(outcome.issue?.message).toMatch(/already exists/);
    expect(comp.mogrtExports).toEqual([]);
  });

  it('exports over an existing file when overwrite is true', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedHero(ae);
    ae.fs.set('/out/Hero.mogrt', '');

    const outcome = invoke(ctx, 'mogrt.export', {
      comp: 'Hero',
      path: '/out/Hero.mogrt',
      overwrite: true,
      controls: [{ layer: 1, property: 'Opacity', name: 'Fade' }],
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ path: '/out/Hero.mogrt', name: 'Hero' });
    expect(comp.motionGraphicsTemplateName).toBe('Hero');
    expect(comp.mogrtExports).toEqual([{ overwrite: true, folder: '/out' }]);
  });

  it('lists the essential graphics controls, including ones it adds', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedHero(ae);

    const outcome = invoke(ctx, 'mogrt.export', {
      comp: 'Hero',
      path: '/out/Hero.mogrt',
      controls: [{ layer: 1, property: 'Opacity', name: 'Fade' }],
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.value?.controls).toEqual([{ index: 1, name: 'Fade' }]);
    expect(comp.egpControls).toEqual(['Fade']);
  });

  it('refuses a control that the essential graphics panel cannot take', async () => {
    const { ctx, ae } = await payloadContext();
    seedHero(ae);

    // Position is an array value, which the panel does not accept.
    const outcome = invoke(ctx, 'mogrt.export', {
      comp: 'Hero',
      path: '/out/Hero.mogrt',
      controls: [{ layer: 1, property: 'Position', name: 'Move' }],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  // AE answers an export with no controls with a modal ("au moins un contrôleur de
  // propriété") that blocks the bridge, so the op refuses before calling it.
  it('refuses a comp with no essential graphics control, without exporting', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedHero(ae);

    const outcome = invoke(ctx, 'mogrt.export', { comp: 'Hero', path: '/out/Hero.mogrt' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
    expect(outcome.issue?.message).toMatch(/at least one Essential Graphics control/);
    expect(comp.mogrtExports).toEqual([]);
  });

  it('requires a .mogrt path', async () => {
    const { ctx, ae } = await payloadContext();
    seedHero(ae);

    const outcome = invoke(ctx, 'mogrt.export', { comp: 'Hero', path: '/out/Hero.mov' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });
});
