import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockProperty, MockPropertyGroup, runInMockAE } from './mock-ae.js';

interface LayerSnapshot {
  index: number;
  name: string;
  type: string;
  inPoint: number;
  outPoint: number;
  parentIndex: number | null;
  enabled: boolean;
  transform: { anchorPoint: unknown; position: unknown; scale: unknown; rotation: unknown; opacity: unknown };
  effects: string[];
  expressions: string[];
}

interface Snapshot {
  comp: string;
  layers: LayerSnapshot[];
}

interface Diff {
  added: string[];
  removed: string[];
  changed: { index: number; name: string; fields: { field: string; before: unknown; after: unknown }[] }[];
}

interface InvokeResult<T> {
  ok: boolean;
  value?: T;
  issue?: unknown;
}

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-verify-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

function invoke<T = unknown>(ctx: vm.Context, tool: string, args: unknown): InvokeResult<T> {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

async function sceneContext(): Promise<{ ctx: vm.Context; ae: MockAE; comp: MockCompItem }> {
  const { ctx, ae } = await payloadContext();
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  invoke(ctx, 'layer.add_solid', { comp: 'Main' });
  invoke(ctx, 'layer.add_solid', { comp: 'Main' });
  const comp = ae.project.item(1) as MockCompItem;
  // The handler always names solids 'Solid'; rename them so the tests can tell them apart.
  nameLayer(comp, 1, 'Backdrop');
  nameLayer(comp, 2, 'Title');
  return { ctx, ae, comp };
}

function nameLayer(comp: MockCompItem, index: number, name: string): void {
  (comp.layer(index) as unknown as { name: string }).name = name;
}

function transformProp(comp: MockCompItem, layerIndex: number, matchName: string): MockProperty {
  const layer = comp.layer(layerIndex) as unknown as MockPropertyGroup;
  const transform = layer.property('ADBE Transform Group') as MockPropertyGroup;
  return transform.property(matchName) as MockProperty;
}

describe('comp.snapshot', () => {
  it('returns each layer with index, name, type, timing, parent, transform, effects and expression flags', async () => {
    const { ctx, comp } = await sceneContext();
    transformProp(comp, 2, 'ADBE Opacity').setValue(80);
    const position = transformProp(comp, 2, 'ADBE Position');
    position.expressionEnabled = true;
    position.expression = 'value';

    const out = invoke<Snapshot>(ctx, 'comp.snapshot', { comp: 'Main' });

    expect(out.ok).toBe(true);
    expect(out.value?.comp).toBe('Main');
    expect(out.value?.layers).toHaveLength(2);
    const title = out.value!.layers[1];
    expect(title.index).toBe(2);
    expect(title.name).toBe('Title');
    expect(title.type).toBe('AVLayer');
    expect(title.parentIndex).toBeNull();
    expect(title.enabled).toBe(true);
    expect(title.inPoint).toBe(0);
    expect(title.transform.opacity).toBe(80);
    expect(title.transform.anchorPoint).toEqual(expect.anything());
    expect(title.transform.scale).toEqual(expect.anything());
    expect(title.effects).toEqual([]);
    expect(title.expressions).toEqual(['ADBE Position']);
    expect(out.value!.layers[0].expressions).toEqual([]);
  });
});

describe('comp.diff', () => {
  it('reports a changed opacity, an added layer and a removed layer', async () => {
    const { ctx, comp } = await sceneContext();
    invoke(ctx, 'layer.add_solid', { comp: 'Main' });
    nameLayer(comp, 3, 'Footer');
    const snapshot = invoke<Snapshot>(ctx, 'comp.snapshot', { comp: 'Main' }).value;

    // Footer is the last layer, so removing it leaves the others at their indices.
    transformProp(comp, 2, 'ADBE Opacity').setValue(40);
    comp.removeLayerAt(3);
    invoke(ctx, 'layer.add_solid', { comp: 'Main' });
    nameLayer(comp, 3, 'Extra');

    const out = invoke<Diff>(ctx, 'comp.diff', { comp: 'Main', snapshot });

    expect(out.ok).toBe(true);
    expect(out.value?.added).toEqual(['Extra']);
    expect(out.value?.removed).toEqual(['Footer']);
    expect(out.value?.changed).toHaveLength(1);
    const changed = out.value!.changed[0];
    expect(changed.name).toBe('Title');
    expect(changed.fields).toEqual([{ field: 'transform.opacity', before: 100, after: 40 }]);
  });

  it('reports nothing when the comp matches the snapshot', async () => {
    const { ctx } = await sceneContext();
    const snapshot = invoke<Snapshot>(ctx, 'comp.snapshot', { comp: 'Main' }).value;

    const out = invoke<Diff>(ctx, 'comp.diff', { comp: 'Main', snapshot });

    expect(out.value).toEqual({ added: [], removed: [], changed: [] });
  });

  it('aborts with INVALID_ARGS when the snapshot has no layers array', async () => {
    const { ctx } = await sceneContext();

    const out = invoke(ctx, 'comp.diff', { comp: 'Main', snapshot: {} });

    expect(out.ok).toBe(false);
    expect(JSON.stringify(out.issue)).toContain('INVALID_ARGS');
  });
});

describe('property.sample', () => {
  it('returns the keyed values at the requested times', async () => {
    const { ctx, comp } = await sceneContext();
    const opacity = transformProp(comp, 2, 'ADBE Opacity');
    opacity.key(0, 0);
    opacity.key(1, 100);

    const out = invoke<{ samples: { time: number; value: unknown }[] }>(ctx, 'property.sample', {
      comp: 'Main',
      index: 2,
      property: 'ADBE Opacity',
      times: [0, 1],
    });

    expect(out.ok).toBe(true);
    expect(out.value?.samples).toEqual([
      { time: 0, value: 0 },
      { time: 1, value: 100 },
    ]);
  });

  it('aborts with INVALID_ARGS when times is empty', async () => {
    const { ctx } = await sceneContext();

    const out = invoke(ctx, 'property.sample', { comp: 'Main', index: 2, property: 'ADBE Opacity', times: [] });

    expect(out.ok).toBe(false);
    expect(JSON.stringify(out.issue)).toContain('INVALID_ARGS');
  });
});
