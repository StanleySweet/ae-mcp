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
