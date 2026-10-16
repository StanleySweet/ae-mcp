/* eslint-disable @typescript-eslint/no-explicit-any -- snapshots are untyped JSON */
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockFile, MockProperty, MockPropertyGroup, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-io-'));
  const ae = new MockAE();
  ae.project.newLayersOnTop = true;
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

interface Outcome {
  value?: any;
  error?: { code: string; message: string };
  issue?: { code: string; message: string };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): Outcome {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

function failureOf(outcome: Outcome): string {
  return JSON.stringify(outcome);
}

describe('project.save', () => {
  it('saves in place', async () => {
    const { ctx, ae } = await payloadContext();
    ae.project.file = new MockFile(ae, '/p/demo.aep');
    expect(invoke(ctx, 'project.save', {}).value).toEqual({ file: '/p/demo.aep' });
  });

  it('saves to a new path', async () => {
    const { ctx, ae } = await payloadContext();
    expect(invoke(ctx, 'project.save', { path: '/p/new.aep' }).value).toEqual({ file: '/p/new.aep' });
    expect(ae.project.file?.fsName).toBe('/p/new.aep');
  });

  it('refuses a never-saved project without a path', async () => {
    const { ctx } = await payloadContext();
    expect(failureOf(invoke(ctx, 'project.save', {}))).toContain('never been saved');
  });
});

describe('project.open', () => {
  it('refuses a missing file', async () => {
    const { ctx } = await payloadContext();
    expect(failureOf(invoke(ctx, 'project.open', { path: '/nope.aep' }))).toContain('file not found');
  });

  it('refuses a dirty project unless forced', async () => {
    const { ctx, ae } = await payloadContext();
    ae.fs.set('/p/other.aep', 'x');
    ae.project.dirty = true;
    expect(failureOf(invoke(ctx, 'project.open', { path: '/p/other.aep' }))).toContain('unsaved changes');
    expect(ae.opened).toEqual([]);
  });

  it('refuses when the dirty flag is unavailable, naming force', async () => {
    const { ctx, ae } = await payloadContext();
    ae.fs.set('/p/other.aep', 'x');
    delete (ae.project as { dirty?: boolean }).dirty;
    expect(failureOf(invoke(ctx, 'project.open', { path: '/p/other.aep' }))).toContain('force: true');
  });

  it('opens a clean project without closing options prompt', async () => {
    const { ctx, ae } = await payloadContext();
    ae.fs.set('/p/other.aep', 'x');
    const outcome = invoke(ctx, 'project.open', { path: '/p/other.aep' });
    expect(outcome.value).toEqual({ file: '/p/other.aep', numItems: 0 });
    expect(ae.project.closed).toEqual([1612]);
  });

  it('closes without saving and opens when forced', async () => {
    const { ctx, ae } = await payloadContext();
    ae.fs.set('/p/other.aep', 'x');
    ae.project.dirty = true;
    const outcome = invoke(ctx, 'project.open', { path: '/p/other.aep', force: true });
    expect(outcome.value).toEqual({ file: '/p/other.aep', numItems: 0 });
    expect(ae.project.closed).toEqual([1612]);
    expect(ae.opened).toEqual(['/p/other.aep']);
  });
});

function seed(ae: MockAE): void {
  const rename = (layer: object, name: string): void => {
    (layer as { name: string }).name = name;
  };
  const comp = ae.app.project.items.addComp('Main', 1280, 720, 1, 10, 25);
  const bg = comp.layers.addSolid([0.2, 0.4, 0.6], 'BG', 1280, 720, 1, 10);
  rename(bg, 'Background');
  const title = comp.layers.addText('Hello');
  rename(title, 'Title');
  const ctrl = comp.layers.addNull(10);
  rename(ctrl, 'Ctrl');
  rename(comp.layers.addShape(), 'Blob');
  const set = (layer: typeof ctrl, match: string, value: unknown): void => {
    ((layer.property('ADBE Transform Group') as MockPropertyGroup).property(match) as MockProperty).setValue(value);
  };
  set(title, 'ADBE Position', [640, 360, 0]);
  set(title, 'ADBE Scale', [50, 50, 100]);
  set(title, 'ADBE Rotate Z', 15);
  set(title, 'ADBE Opacity', 80);
  set(ctrl, 'ADBE Anchor Point', [5, 6, 0]);
}

function summary(snapshot: any): unknown {
  return snapshot.items
    .filter((item: any) => item.type === 'Composition')
    .map((comp: any) => ({
      name: comp.name,
      size: [comp.width, comp.height, comp.pixelAspect, comp.duration, comp.frameRate],
      layers: comp.layers.map((layer: any) => ({
        name: layer.name,
        type: layer.type,
        nullLayer: layer.nullLayer,
        solidColor: layer.solidColor,
        text: layer.text?.text,
        transform: layer.transform.properties
          .filter((p: any) => ['ADBE Anchor Point', 'ADBE Position', 'ADBE Scale', 'ADBE Rotate Z', 'ADBE Opacity'].includes(p.matchName))
          .map((p: any) => [p.matchName, p.value]),
      })),
    }));
}

describe('project.import_json', () => {
  it('round-trips export_json into a fresh project', async () => {
    const source = await payloadContext();
    seed(source.ae);
    const snapshot = invoke(source.ctx, 'project.export_json', null).value;

    const target = await payloadContext();
    const outcome = invoke(target.ctx, 'project.import_json', { snapshot });
    expect(outcome.value).toEqual({ comps: [{ name: 'Main', layers: 4 }], skipped: [] });

    const again = invoke(target.ctx, 'project.export_json', null).value;
    expect(summary(again)).toEqual(summary(snapshot));
    expect((summary(again) as any)[0].layers.map((l: any) => l.name)).toEqual(['Blob', 'Ctrl', 'Title', 'Background']);
  });

  it('reports unsupported layers as skipped', async () => {
    const { ctx } = await payloadContext();
    const snapshot = {
      format: 'aemcp-project/v1',
      items: [
        {
          type: 'Composition', name: 'C', width: 100, height: 100, pixelAspect: 1, duration: 1, frameRate: 24,
          layers: [{ name: 'clip', type: 'AVLayer', sourceId: 9, sourceName: 'clip.mov', width: 10, height: 10 }, { name: 'Cam', type: 'CameraLayer' }],
        },
      ],
    };
    const outcome = invoke(ctx, 'project.import_json', { snapshot });
    expect(outcome.value).toEqual({
      comps: [{ name: 'C', layers: 0 }],
      skipped: [
        { comp: 'C', layer: 'Cam', type: 'CameraLayer' },
        { comp: 'C', layer: 'clip', type: 'AVLayer' },
      ],
    });
  });

  it('rejects a snapshot with the wrong format', async () => {
    const { ctx } = await payloadContext();
    expect(failureOf(invoke(ctx, 'project.import_json', { snapshot: { format: 'x' } }))).toContain('aemcp-project/v1');
  });
});

