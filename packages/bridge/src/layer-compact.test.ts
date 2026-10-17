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

function transformNames(layer: { transform?: { properties?: { matchName: string }[] } }): string[] {
  return (layer.transform?.properties ?? []).map((entry) => entry.matchName);
}

describe('ae_layer_info compact report (#250)', () => {
  // Transform values are always reported: leaving Position or Anchor Point out at their
  // defaults read as "missing" to a Claude Desktop session (2026-10-17).
  it('keeps every transform value and drops only empty arrays by default', async () => {
    const { ctx } = await setup();

    const r = invoke(ctx, 'ae_layer_info', { comp: 'Main' });

    expect(r.ok).toBe(true);
    const layer = r.value.layers[0];
    expect(transformNames(layer)).toEqual(['ADBE Anchor Point', 'ADBE Position', 'ADBE Scale', 'ADBE Rotate Z', 'ADBE Opacity']);
    expect(layer.transform.groups).toBeUndefined();
    expect(layer.effects).toBeUndefined();
    expect(layer.masks).toBeUndefined();
    expect(layer.markers).toBeUndefined();
    expect(layer.name).toBe('Null');
  });

  it('leaves out X/Y/Z Position unless Position dimensions are separated', async () => {
    const { ctx, ae } = await setup();
    const layer = (ae.project.item(1) as MockCompItem).layer(1) as unknown as MockPropertyGroup;
    const transform = layer.property('ADBE Transform Group') as MockPropertyGroup;
    const position = transform.property('ADBE Position') as unknown as Record<string, unknown>;
    const xPosition = transform.property('ADBE Opacity') as unknown as Record<string, unknown>;
    // Stand-in follower: AE reports an unused X Position as 0 next to the real Position.
    xPosition.isSeparationFollower = true;
    xPosition.separationLeader = position;

    position.dimensionsSeparated = false;
    expect(transformNames(invoke(ctx, 'ae_layer_info', { comp: 'Main' }).value.layers[0])).not.toContain('ADBE Opacity');

    position.dimensionsSeparated = true;
    expect(transformNames(invoke(ctx, 'ae_layer_info', { comp: 'Main' }).value.layers[0])).toContain('ADBE Opacity');
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

  it('fields including transform keeps the transform values', async () => {
    const { ctx } = await setup();

    const compact = invoke(ctx, 'ae_layer_info', { comp: 'Main', fields: ['transform'] }).value.layers[0];

    expect(transformNames(compact)).toHaveLength(5);
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
