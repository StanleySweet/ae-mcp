import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockPropertyGroup, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-layer-compact-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reports are untyped JSON
function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: any; issue?: { code: string; message: string } } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

/** An 800x600 comp with one null layer whose transform sits at the factory defaults for that comp. */
async function setup(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const { ctx, ae } = await payloadContext();
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  invoke(ctx, 'layer.add_null', { comp: 'Main' });
  const layer = (ae.project.item(1) as MockCompItem).layer(1) as unknown as MockPropertyGroup;
  const transform = layer.property('ADBE Transform Group') as MockPropertyGroup;
  (transform.property('ADBE Position') as unknown as { value: unknown }).value = [400, 300, 0];
  return { ctx, ae };
}

function setTransform(ae: MockAE, matchName: string, value: unknown): void {
  const layer = (ae.project.item(1) as MockCompItem).layer(1) as unknown as MockPropertyGroup;
  const transform = layer.property('ADBE Transform Group') as MockPropertyGroup;
  (transform.property(matchName) as unknown as { value: unknown }).value = value;
}

function transformNames(layer: { transform?: { properties?: { matchName: string }[] } }): string[] {
  return (layer.transform?.properties ?? []).map((entry) => entry.matchName);
}

describe('ae_layer_info compact report (#250)', () => {
  it('omits transform values at their factory defaults and empty arrays by default', async () => {
    const { ctx } = await setup();

    const r = invoke(ctx, 'ae_layer_info', { comp: 'Main' });

    expect(r.ok).toBe(true);
    const layer = r.value.layers[0];
    expect(layer.transform.properties).toBeUndefined();
    expect(layer.transform.groups).toBeUndefined();
    expect(layer.effects).toBeUndefined();
    expect(layer.masks).toBeUndefined();
    expect(layer.markers).toBeUndefined();
    expect(layer.name).toBe('Null');
  });

  it('keeps transform values that differ from their defaults', async () => {
    const { ctx, ae } = await setup();
    setTransform(ae, 'ADBE Opacity', 50);
    setTransform(ae, 'ADBE Position', [100, 300, 0]);

    const layer = invoke(ctx, 'ae_layer_info', { comp: 'Main' }).value.layers[0];

    expect(transformNames(layer)).toEqual(['ADBE Position', 'ADBE Opacity']);
    expect(layer.transform.properties[1].value).toBe(50);
  });

  it('keeps animated and expression-driven values even when they sit at the default', async () => {
    const { ctx, ae } = await setup();
    const layer = (ae.project.item(1) as MockCompItem).layer(1) as unknown as MockPropertyGroup;
    const opacity = (layer.property('ADBE Transform Group') as MockPropertyGroup).property('ADBE Opacity') as unknown as {
      keys: { time: number; value: unknown }[];
      expressionEnabled: boolean;
      expression: string;
    };
    opacity.keys.push({ time: 0, value: 100 });
    setTransform(ae, 'ADBE Rotate Z', 0);
    const rotate = (layer.property('ADBE Transform Group') as MockPropertyGroup).property('ADBE Rotate Z') as unknown as {
      expressionEnabled: boolean;
      expression: string;
    };
    rotate.expressionEnabled = true;
    rotate.expression = 'time * 10';

    const out = invoke(ctx, 'ae_layer_info', { comp: 'Main' }).value.layers[0];

    expect(transformNames(out)).toEqual(['ADBE Rotate Z', 'ADBE Opacity']);
  });

  it('full returns every transform value and empty arrays', async () => {
    const { ctx } = await setup();

    const layer = invoke(ctx, 'ae_layer_info', { comp: 'Main', full: true }).value.layers[0];

    expect(transformNames(layer)).toEqual([
      'ADBE Anchor Point',
      'ADBE Position',
      'ADBE Scale',
      'ADBE Rotate Z',
      'ADBE Opacity',
    ]);
    expect(layer.effects).toEqual([]);
    expect(layer.masks).toEqual([]);
  });

  it('fields selects top-level keys and always keeps index', async () => {
    const { ctx } = await setup();

    const layer = invoke(ctx, 'ae_layer_info', { comp: 'Main', fields: ['name', 'inPoint'] }).value.layers[0];

    expect(Object.keys(layer).sort()).toEqual(['inPoint', 'index', 'name']);
    expect(layer.name).toBe('Null');
  });

  it('fields including transform still omits defaults unless full is set', async () => {
    const { ctx } = await setup();

    const compact = invoke(ctx, 'ae_layer_info', { comp: 'Main', fields: ['transform'] }).value.layers[0];
    const full = invoke(ctx, 'ae_layer_info', { comp: 'Main', fields: ['transform'], full: true }).value.layers[0];

    expect(compact.transform.properties).toBeUndefined();
    expect(transformNames(full)).toHaveLength(5);
  });

  it('summary returns only index, name and type per layer', async () => {
    const { ctx } = await setup();

    const layer = invoke(ctx, 'ae_layer_info', { comp: 'Main', summary: true, fields: ['name'] }).value.layers[0];

    expect(layer).toEqual({ index: 1, name: 'Null', type: 'AVLayer' });
  });

  it('shrinks the default report well below the full one for a fixture comp', async () => {
    const { ctx } = await setup();
    const sizeOf = (args: Record<string, unknown>): number =>
      JSON.stringify(invoke(ctx, 'ae_layer_info', args).value).length;

    const defaults = sizeOf({ comp: 'Main' });
    const full = sizeOf({ comp: 'Main', full: true });
    const summary = sizeOf({ comp: 'Main', summary: true });

    expect(defaults).toBeLessThan(full);
    expect(summary).toBeLessThan(defaults);
  });

  it('refuses an unknown field name', async () => {
    const { ctx } = await setup();

    const r = invoke(ctx, 'ae_layer_info', { comp: 'Main', fields: ['nope'] });

    expect(r.issue?.code).toBe('INVALID_ARGS');
  });
});
