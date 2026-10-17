import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockAVLayer, MockCompItem, MockProperty, MockPropertyGroup, PropertyValueType, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-errors-'));
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

// A comp with one layer carrying Opacity under the ADBE Transform Group.
async function layerContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const { ctx, ae } = await payloadContext();
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  const comp = ae.project.item(1) as MockCompItem;
  const layer = new MockAVLayer('Layer', 'Layer');
  const transform = new MockPropertyGroup('Transform', 'ADBE Transform Group');
  transform.add(new MockProperty('Opacity', 'ADBE Opacity', 100));
  const position = new MockProperty('Position', 'ADBE Position', [0, 0, 0]);
  position.propertyValueType = PropertyValueType.ThreeD;
  transform.add(position);
  transform.add(new MockProperty('Scale', 'ADBE Scale', [100, 100, 100]));
  layer.add(transform);
  comp.addLayer(layer);
  return { ctx, ae };
}

describe('precise INVALID_ARGS details', () => {
  it('suggests the closest property match name for a misspelled property', async () => {
    const { ctx } = await layerContext();

    const out = invoke(ctx, 'keyframe.add', {
      comp: 'Main',
      index: 1,
      property: 'ADBE Opacty',
      time: 0,
      value: 50,
    });

    expect(out.issue).toMatchObject({
      code: 'INVALID_ARGS',
      message: 'Property not found: ADBE Opacty',
      details: { arg: 'property', closest: ['ADBE Opacity'] },
    });
  });

  it('omits closest when no property is close', async () => {
    const { ctx } = await layerContext();

    const out = invoke(ctx, 'keyframe.add', {
      comp: 'Main',
      index: 1,
      property: 'ADBE Zzzzzzzzzzzz',
      time: 0,
      value: 50,
    });

    const issue = out.issue as { details: Record<string, unknown> };
    expect(issue.details.arg).toBe('property');
    expect(issue.details).not.toHaveProperty('closest');
  });
});
