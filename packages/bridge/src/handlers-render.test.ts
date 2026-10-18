import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockAVLayer, MockCompItem, runInMockAE } from './mock-ae.js';

interface Outcome {
  ok: boolean;
  value?: Record<string, unknown>;
  issue?: { code: string; message: string };
}

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE; home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-render-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae, home };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): Outcome {
  vm.runInContext(`var __args = ${JSON.stringify(args)};`, ctx);
  const json = vm.runInContext(
    `JSON.stringify(AEMCP.invoke(${JSON.stringify(tool)}, __args, 9999999999999))`,
    ctx,
  ) as string;
  return JSON.parse(json) as Outcome;
}

// A render file is `<prefix><unique suffix>.png`, so no two renders share a name (E16-3).
function expectFreshName(file: string, prefix: string): void {
  expect(file.startsWith(prefix)).toBe(true);
  expect(file.endsWith('.png')).toBe(true);
  expect(file.length).toBeGreaterThan(prefix.length + '.png'.length);
}

function seedComp(ae: MockAE, layerCount = 0): MockCompItem {
  const comp = new MockCompItem(1, 'Main', 1920, 1080, 25, 10);
  ae.project.add(comp);
  ae.project.activeItem = comp;
  for (let i = 1; i <= layerCount; i += 1) {
    const layer = new MockAVLayer(`Layer ${i}`, 'Layer');
    comp.addLayer(layer);
  }
  return comp;
}

describe('render.frame', () => {
  it('saves the frame directly when CompItem.saveFrameToPng is available', async () => {
    const { ctx, ae, home } = await payloadContext();
    const comp = seedComp(ae, 1);
    const outcome = invoke(ctx, 'render.frame', { comp: 'Main', time: 1 });
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({
      method: 'direct',
      comp: 'Main',
      time: 1,
      frame: 25,
      width: 1920,
      height: 1080,
    });
    expect(comp.numLayers).toBe(1);
    const file = outcome.value?.file as string;
    expectFreshName(file, `${home}/.ae-mcp/render/Main-25-`);
    expect(ae.fs.get(file)).toBe('PNG:Main:1');
  });

  // An effect-only change left the cached frame in place (#281): every render purges the image caches first.
  it('purges the image caches before saving, so an effect change shows', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, 1);
    const outcome = invoke(ctx, 'render.frame', { comp: 'Main', time: 1 });
    expect(outcome.ok).toBe(true);
    expect(ae.purgeCalls).toEqual(['IMAGE_CACHES']);
  });

  // E16-3: a second render of the same frame writes a new file, never the earlier one.
  it('gives each render of the same frame a fresh file name', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, 1);
    const first = invoke(ctx, 'render.frame', { comp: 'Main', time: 1 }).value?.file as string;
    const second = invoke(ctx, 'render.frame', { comp: 'Main', time: 1 }).value?.file as string;
    expect(second).not.toBe(first);
    expect(ae.fs.get(first)).toBe('PNG:Main:1');
    expect(ae.fs.get(second)).toBe('PNG:Main:1');
  });

  it('defaults time to zero and the path to the render directory', async () => {
    const { ctx, ae, home } = await payloadContext();
    seedComp(ae);
    const outcome = invoke(ctx, 'render.frame', { comp: 'Main' });
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ method: 'direct', time: 0, frame: 0 });
    expectFreshName(outcome.value?.file as string, `${home}/.ae-mcp/render/Main-0-`);
  });

  // A read-only op must not write outside the render folder (#178).
  it('ignores a file argument and sanitises the comp name', async () => {
    const { ctx, ae, home } = await payloadContext();
    ae.project.items.addComp('My Comp/01', 640, 480, 1, 4, 24);
    const custom = `${home}/out/custom.png`;
    const outcome = invoke(ctx, 'render.frame', { comp: 'My Comp/01', time: 0.5, file: custom });
    expectFreshName(outcome.value?.file as string, `${home}/.ae-mcp/render/My_Comp_01-12-`);
    expect(ae.fs.has(custom)).toBe(false);
  });

  // draft: true renders at half resolution for that one frame, then restores the comp (#278).
  // Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemresolutionfactor
  it('renders a draft frame at half resolution and restores the comp', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, 1);
    let during: unknown = null;
    Object.defineProperty(comp, 'saveFrameToPng', {
      value: (): void => {
        during = [comp.resolutionFactor[0], comp.resolutionFactor[1]];
      },
      configurable: true,
    });
    const outcome = invoke(ctx, 'render.frame', { comp: 'Main', time: 1, draft: true });
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ method: 'direct', draft: true });
    expect(during).toEqual([2, 2]);
    expect(comp.resolutionFactor).toEqual([1, 1]);
  });

  it('restores the resolution factor when the draft render throws', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, 1);
    Object.defineProperty(comp, 'saveFrameToPng', {
      value: (): void => {
        throw new Error('render failed');
      },
      configurable: true,
    });
    const outcome = invoke(ctx, 'render.frame', { comp: 'Main', time: 1, draft: true });
    expect(outcome.ok).toBe(false);
    expect(comp.resolutionFactor).toEqual([1, 1]);
  });

  it('omits the draft flag from the result when draft is not requested', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, 1);
    const outcome = invoke(ctx, 'render.frame', { comp: 'Main', time: 1 });
    expect(outcome.value).not.toHaveProperty('draft');
    expect(comp.resolutionFactor).toEqual([1, 1]);
  });

  it('falls back to the render queue when saveFrameToPng is unavailable', async () => {
    const { ctx, ae, home } = await payloadContext();
    const comp = seedComp(ae);
    Object.defineProperty(comp, 'saveFrameToPng', { value: undefined, configurable: true });
    const outcome = invoke(ctx, 'render.frame', { comp: 'Main', time: 2 });
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ method: 'queue', frame: 50 });
    const file = outcome.value?.file as string;
    expectFreshName(file, `${home}/.ae-mcp/render/Main-50-`);
    expect(ae.fs.get(file)).toBe('PNG:Main:2');
    // The fallback removes its temporary queue item again, so the queue is left empty.
    expect(ae.project.renderQueue.numItems).toBe(0);
  });

  it('defaults to the active comp and reports an unknown comp as INVALID_ARGS', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae);
    expect(invoke(ctx, 'render.frame', {}).value).toMatchObject({ comp: 'Main' });
    const missing = invoke(ctx, 'render.frame', { comp: 'Nope' });
    expect(missing.ok).toBe(false);
    expect(missing.issue?.code).toBe('INVALID_ARGS');
    expect(missing.issue?.message).toContain('Nope');
  });
});

describe('render queue operations', () => {
  it('adds a composition with a time span and reports the item', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae);
    const outcome = invoke(ctx, 'render.queue_add', {
      comp: 'Main',
      timeSpanStart: 1,
      timeSpanDuration: 2,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({
      index: 1,
      comp: 'Main',
      status: 'QUEUED',
      render: true,
      timeSpanStart: 1,
      timeSpanDuration: 2,
      numOutputModules: 1,
    });
    expect(ae.project.renderQueue.numItems).toBe(1);
  });

  it('defaults to the active comp and rejects an unknown comp', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae);
    expect(invoke(ctx, 'render.queue_add', {}).value).toMatchObject({ comp: 'Main' });
    const missing = invoke(ctx, 'render.queue_add', { comp: 'Nope' });
    expect(missing.ok).toBe(false);
    expect(missing.issue?.code).toBe('INVALID_ARGS');
  });

  it('sets the output file and applies a template', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae);
    invoke(ctx, 'render.queue_add', { comp: 'Main' });
    const outcome = invoke(ctx, 'render.queue_set_output', {
      item: 1,
      file: '/tmp/out.mov',
      template: 'Lossless',
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ index: 1, outputFile: '/tmp/out.mov' });
    expect(ae.project.renderQueue.item(1)?.outputModule(1)?.template).toBe('Lossless');
  });

  it('reports an unknown item index as INVALID_ARGS', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae);
    const outcome = invoke(ctx, 'render.queue_set_output', { item: 3, file: '/tmp/x.mov' });
    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
    expect(outcome.issue?.message).toContain('render queue item not found: 3');
  });

  it('reports queue status for a queued item', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae);
    invoke(ctx, 'render.queue_add', { comp: 'Main' });
    invoke(ctx, 'render.queue_set_output', { item: 1, file: '/tmp/out.png' });

    const before = invoke(ctx, 'render.status', {});
    expect(before.value).toMatchObject({ numItems: 1, rendering: false });
    expect((before.value?.items as { status: string }[])[0]?.status).toBe('QUEUED');
  });

  // RenderQueue.render() blocks AE past the job deadline; ae_render covers it (#180).
  it('has no render.queue_start', async () => {
    const { ctx } = await payloadContext();

    const outcome = invoke(ctx, 'render.queue_start', {});

    expect(outcome.issue?.code).toBe('UNKNOWN_TOOL');
  });
});
