import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockProperty, MockPropertyGroup, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-shape-'));
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

async function shapeLayerContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const { ctx, ae } = await payloadContext();
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  invoke(ctx, 'layer.add_shape', { comp: 'Main' });
  return { ctx, ae };
}

function firstGroup(ae: MockAE): MockPropertyGroup {
  const layer = (ae.project.item(1) as MockCompItem).layer(1) as unknown as MockPropertyGroup;
  const root = layer.property('ADBE Root Vectors Group') as MockPropertyGroup;
  return root.property(1) as MockPropertyGroup;
}

function groupContents(ae: MockAE): MockPropertyGroup {
  return firstGroup(ae).property('ADBE Vectors Group') as MockPropertyGroup;
}

describe('shape.add', () => {
  it('adds a freeform path with the ADBE Vector Shape - Group match name', async () => {
    const { ctx, ae } = await shapeLayerContext();

    const out = invoke(ctx, 'shape.add', {
      comp: 'Main',
      layerIndex: 1,
      type: 'path',
      name: 'Almond',
      vertices: [[-240, 0], [240, 0]],
      inTangents: [[0, 150], [0, -150]],
      outTangents: [[0, -150], [0, 150]],
      closed: true,
      strokeColor: [0.2, 1, 0.4],
      strokeWidth: 26,
    });

    expect(out.ok).toBe(true);
    const contents = groupContents(ae);
    const path = contents.property('ADBE Vector Shape - Group') as MockPropertyGroup;
    expect(path).not.toBeNull();
    const shape = (path.property('ADBE Vector Shape') as MockProperty).value as { vertices: number[][]; closed: boolean };
    expect(shape.vertices).toEqual([[-240, 0], [240, 0]]);
    expect(shape.closed).toBe(true);
    const stroke = contents.property('ADBE Vector Graphic - Stroke') as MockPropertyGroup;
    expect((stroke.property('ADBE Vector Stroke Width') as MockProperty).value).toBe(26);
  });

  it('adds an ellipse with a fill', async () => {
    const { ctx, ae } = await shapeLayerContext();

    const out = invoke(ctx, 'shape.add', {
      comp: 'Main',
      layerIndex: 1,
      type: 'ellipse',
      size: [190, 190],
      fillColor: [0.2, 1, 0.4],
    });

    expect(out.ok).toBe(true);
    const contents = groupContents(ae);
    const ellipse = contents.property('ADBE Vector Shape - Ellipse') as MockPropertyGroup;
    expect((ellipse.property('ADBE Vector Ellipse Size') as MockProperty).value).toEqual([190, 190]);
    const fill = contents.property('ADBE Vector Graphic - Fill') as MockPropertyGroup;
    expect((fill.property('ADBE Vector Fill Color') as MockProperty).value).toEqual([0.2, 1, 0.4]);
  });
});

// `name` used to be ignored on an existing layer, or given to the new layer (#185).
describe('shape.add naming', () => {
  it('names the shape group, not the layer', async () => {
    const { ctx, ae } = await shapeLayerContext();

    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'ellipse', name: 'Iris' });

    expect(firstGroup(ae).name).toBe('Iris');
    expect((ae.project.item(1) as MockCompItem).layer(1)?.name).toBe('Shape');
  });

  it('names a layer it creates with layerName', async () => {
    const { ctx, ae } = await shapeLayerContext();

    const out = invoke(ctx, 'shape.add', { comp: 'Main', type: 'ellipse', name: 'Pupil', layerName: 'Eye' });

    const index = (out.value as { layerIndex: number }).layerIndex;
    const layer = (ae.project.item(1) as MockCompItem).layer(index) as unknown as MockPropertyGroup & { name: string };
    expect(layer.name).toBe('Eye');
    const root = layer.property('ADBE Root Vectors Group') as MockPropertyGroup;
    expect((root.property(1) as MockPropertyGroup).name).toBe('Pupil');
  });
});

describe('shape.set', () => {
  it('updates the first freeform path', async () => {
    const { ctx, ae } = await shapeLayerContext();
    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'path', vertices: [[0, 0], [10, 0]] });

    const out = invoke(ctx, 'shape.set', { comp: 'Main', layerIndex: 1, vertices: [[0, 0], [50, 50], [100, 0]] });

    expect(out.ok).toBe(true);
    const path = groupContents(ae).property('ADBE Vector Shape - Group') as MockPropertyGroup;
    const shape = (path.property('ADBE Vector Shape') as MockProperty).value as { vertices: number[][] };
    expect(shape.vertices).toEqual([[0, 0], [50, 50], [100, 0]]);
  });
});

// The 44 copied comp lookups matched by name only and ignored the active comp (#184).
describe('comp resolution', () => {
  it('shape.add without comp targets the active comp', async () => {
    const { ctx, ae } = await shapeLayerContext();
    ae.project.activeItem = ae.project.item(1) ?? null;

    const out = invoke(ctx, 'shape.add', { layerIndex: 1, type: 'ellipse' });

    expect(out.ok).toBe(true);
    expect(groupContents(ae).property('ADBE Vector Shape - Ellipse')).not.toBeNull();
  });

  it('reports a missing comp as INVALID_ARGS naming it', async () => {
    const { ctx } = await shapeLayerContext();

    const out = invoke(ctx, 'shape.add', { comp: 'Nope', layerIndex: 1, type: 'ellipse' });

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'composition not found: Nope' });
  });
});

function groupAt(ae: MockAE, index: number): MockPropertyGroup {
  const layer = (ae.project.item(1) as MockCompItem).layer(1) as unknown as MockPropertyGroup;
  const root = layer.property('ADBE Root Vectors Group') as MockPropertyGroup;
  return root.property(index) as MockPropertyGroup;
}

function groupTransform(group: MockPropertyGroup): MockPropertyGroup {
  return group.property('ADBE Vector Transform Group') as MockPropertyGroup;
}

function valueOf(group: MockPropertyGroup, matchName: string): unknown {
  return (group.property(matchName) as MockProperty).value;
}

describe('shape.add richer fields', () => {
  it('sets the ellipse position on the ellipse, not the group', async () => {
    const { ctx, ae } = await shapeLayerContext();

    const out = invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'ellipse', position: [320, 180] });

    expect(out.ok).toBe(true);
    const ellipse = groupContents(ae).property('ADBE Vector Shape - Ellipse') as MockPropertyGroup;
    expect(valueOf(ellipse, 'ADBE Vector Ellipse Position')).toEqual([320, 180]);
  });

  it('sets the rect position on a rectangle', async () => {
    const { ctx, ae } = await shapeLayerContext();

    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'rect', position: [-10, 5] });

    const rect = groupContents(ae).property('ADBE Vector Shape - Rect') as MockPropertyGroup;
    expect(valueOf(rect, 'ADBE Vector Rect Position')).toEqual([-10, 5]);
  });

  it('refuses position on a freeform path', async () => {
    const { ctx } = await shapeLayerContext();

    const out = invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'path', position: [1, 1] });

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS' });
  });

  it('sets fill and stroke opacity on their graphic groups', async () => {
    const { ctx, ae } = await shapeLayerContext();

    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'ellipse', fillOpacity: 40, strokeOpacity: 75 });

    const contents = groupContents(ae);
    const fill = contents.property('ADBE Vector Graphic - Fill') as MockPropertyGroup;
    const stroke = contents.property('ADBE Vector Graphic - Stroke') as MockPropertyGroup;
    expect(valueOf(fill, 'ADBE Vector Fill Opacity')).toBe(40);
    expect(valueOf(stroke, 'ADBE Vector Stroke Opacity')).toBe(75);
  });

  it('rejects an opacity outside 0-100', async () => {
    const { ctx } = await shapeLayerContext();

    const out = invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'ellipse', fillOpacity: 120 });

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS' });
  });

  it('sets the group transform on the Vector Group transform, without addProperty', async () => {
    const { ctx, ae } = await shapeLayerContext();

    invoke(ctx, 'shape.add', {
      comp: 'Main',
      layerIndex: 1,
      type: 'ellipse',
      groupPosition: [100, 200],
      groupScale: [50, 50],
      groupRotation: 15,
      groupOpacity: 60,
    });

    const transform = groupTransform(firstGroup(ae));
    expect(valueOf(transform, 'ADBE Vector Position')).toEqual([100, 200]);
    expect(valueOf(transform, 'ADBE Vector Scale')).toEqual([50, 50]);
    expect(valueOf(transform, 'ADBE Vector Rotation')).toBe(15);
    expect(valueOf(transform, 'ADBE Vector Group Opacity')).toBe(60);
  });

  it('leaves the group transform at its defaults when no group field is given', async () => {
    const { ctx, ae } = await shapeLayerContext();

    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'ellipse' });

    const transform = groupTransform(firstGroup(ae));
    expect(valueOf(transform, 'ADBE Vector Position')).toEqual([0, 0]);
    expect(valueOf(transform, 'ADBE Vector Group Opacity')).toBe(100);
  });

  it('appends the new group below existing groups by default', async () => {
    const { ctx, ae } = await shapeLayerContext();
    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'ellipse', name: 'Back' });

    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'ellipse', name: 'Front' });

    expect(groupAt(ae, 1).name).toBe('Back');
    expect(groupAt(ae, 2).name).toBe('Front');
  });

  it('moves the new group to the top with front: true', async () => {
    const { ctx, ae } = await shapeLayerContext();
    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'ellipse', name: 'Back' });

    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'ellipse', name: 'Top', front: true });

    expect(groupAt(ae, 1).name).toBe('Top');
    expect(groupAt(ae, 2).name).toBe('Back');
  });
});

describe('shape.set richer fields', () => {
  it('edits the group chosen by group, leaving group 1 alone', async () => {
    const { ctx, ae } = await shapeLayerContext();
    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'path', vertices: [[0, 0], [10, 0]] });
    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'path', vertices: [[1, 1], [2, 2]] });

    const out = invoke(ctx, 'shape.set', { comp: 'Main', layerIndex: 1, group: 2, vertices: [[5, 5], [6, 6]] });

    expect(out.ok).toBe(true);
    const second = groupAt(ae, 2).property('ADBE Vectors Group') as MockPropertyGroup;
    const path = second.property('ADBE Vector Shape - Group') as MockPropertyGroup;
    expect((path.property('ADBE Vector Shape') as MockProperty).value).toMatchObject({ vertices: [[5, 5], [6, 6]] });
    const first = groupContents(ae).property('ADBE Vector Shape - Group') as MockPropertyGroup;
    expect((first.property('ADBE Vector Shape') as MockProperty).value).toMatchObject({ vertices: [[0, 0], [10, 0]] });
  });

  it('aborts when the group does not exist', async () => {
    const { ctx } = await shapeLayerContext();
    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'ellipse' });

    const out = invoke(ctx, 'shape.set', { comp: 'Main', layerIndex: 1, group: 5, groupOpacity: 10 });

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'group not found: 5' });
  });

  it('sets the group transform and ellipse position of the chosen group', async () => {
    const { ctx, ae } = await shapeLayerContext();
    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'ellipse' });

    const out = invoke(ctx, 'shape.set', { comp: 'Main', layerIndex: 1, group: 1, groupRotation: 45, position: [7, 8] });

    expect(out.ok).toBe(true);
    expect(valueOf(groupTransform(firstGroup(ae)), 'ADBE Vector Rotation')).toBe(45);
    const ellipse = groupContents(ae).property('ADBE Vector Shape - Ellipse') as MockPropertyGroup;
    expect(valueOf(ellipse, 'ADBE Vector Ellipse Position')).toEqual([7, 8]);
  });

  it('sets fill opacity on the chosen group and moves it to the top with front', async () => {
    const { ctx, ae } = await shapeLayerContext();
    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'ellipse', name: 'Back' });
    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'ellipse', name: 'Other', fillColor: [1, 1, 1] });

    const out = invoke(ctx, 'shape.set', { comp: 'Main', layerIndex: 1, group: 2, fillOpacity: 30, front: true });

    expect(out.ok).toBe(true);
    const top = groupAt(ae, 1);
    expect(top.name).toBe('Other');
    const fill = (top.property('ADBE Vectors Group') as MockPropertyGroup).property('ADBE Vector Graphic - Fill') as MockPropertyGroup;
    expect(valueOf(fill, 'ADBE Vector Fill Opacity')).toBe(30);
  });
});

describe('shape.read', () => {
  it('returns each group with its items and transform', async () => {
    const { ctx } = await shapeLayerContext();
    invoke(ctx, 'shape.add', {
      comp: 'Main',
      layerIndex: 1,
      type: 'ellipse',
      name: 'Iris',
      size: [190, 190],
      position: [10, 20],
      fillColor: [0.2, 1, 0.4],
      fillOpacity: 50,
      strokeColor: [1, 0, 0],
      strokeWidth: 3,
      strokeOpacity: 80,
      groupPosition: [1, 2],
      groupScale: [100, 100],
      groupRotation: 5,
      groupOpacity: 90,
    });

    const out = invoke(ctx, 'shape.read', { comp: 'Main', layerIndex: 1 });

    expect(out.ok).toBe(true);
    expect((out.value as { groups: unknown[] }).groups).toEqual([
      {
        index: 1,
        name: 'Iris',
        items: [
          { type: 'ellipse', size: [190, 190], position: [10, 20] },
          { type: 'fill', color: [0.2, 1, 0.4], opacity: 50 },
          { type: 'stroke', color: [1, 0, 0], opacity: 80, width: 3 },
        ],
        transform: { position: [1, 2], scale: [100, 100], rotation: 5, opacity: 90 },
      },
    ]);
  });

  it('reads path vertices, tangents and closed', async () => {
    const { ctx } = await shapeLayerContext();
    invoke(ctx, 'shape.add', { comp: 'Main', layerIndex: 1, type: 'path', vertices: [[0, 0], [10, 0]], closed: true });

    const out = invoke(ctx, 'shape.read', { comp: 'Main', layerIndex: 1 });

    const items = (out.value as { groups: { items: unknown[] }[] }).groups[0].items;
    expect(items[0]).toMatchObject({ type: 'path', vertices: [[0, 0], [10, 0]], closed: true });
  });

  it('reports a missing layer as INVALID_ARGS', async () => {
    const { ctx } = await shapeLayerContext();

    const out = invoke(ctx, 'shape.read', { comp: 'Main', layerIndex: 9 });

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'layer not found: 9' });
  });
});
