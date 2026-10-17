import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockFile, runInMockAE } from './mock-ae.js';

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

// A saved project whose Hero comp already has one control and its template name: ready to export.
function readyToExport(ae: MockAE, comp: MockCompItem): void {
  comp.egpControls.push('Fade');
  comp.motionGraphicsTemplateName = 'Hero';
  ae.project.file = new MockFile(ae, '/p/hero.aep');
  ae.project.dirty = false;
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
    readyToExport(ae, comp);

    const outcome = invoke(ctx, 'mogrt.export', { comp: 'Hero', path: '/out/Hero.mogrt', overwrite: true });

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ exported: true, path: '/out/Hero.mogrt', name: 'Hero' });
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

    // Adding a control is an unsaved change: AE would ask to save in a modal, so no export yet.
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ exported: false, controls: [{ index: 1, name: 'Fade' }] });
    expect(String(outcome.value?.reason)).toMatch(/project\.save/);
    expect(comp.egpControls).toEqual(['Fade']);
    expect(comp.mogrtExports).toEqual([]);
  });

  it('does not export a project with unsaved changes', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedHero(ae);
    readyToExport(ae, comp);
    ae.project.dirty = true;

    const outcome = invoke(ctx, 'mogrt.export', { comp: 'Hero', path: '/out/Hero.mogrt' });

    expect(outcome.value).toMatchObject({ exported: false });
    expect(comp.mogrtExports).toEqual([]);
  });

  it('does not export a project that was never saved', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedHero(ae);
    readyToExport(ae, comp);
    ae.project.file = null;

    const outcome = invoke(ctx, 'mogrt.export', { comp: 'Hero', path: '/out/Hero.mogrt' });

    expect(outcome.value).toMatchObject({ exported: false });
    expect(comp.mogrtExports).toEqual([]);
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
