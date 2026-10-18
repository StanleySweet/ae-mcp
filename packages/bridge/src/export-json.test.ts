import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import {
  MockAE,
  MockAVLayer,
  MockCompItem,
  MockEffect,
  MockFolderItem,
  MockFootageItem,
  MockFile,
  MockProperty,
  MockPropertyGroup,
  runInMockAE,
} from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-export-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

function seed(ae: MockAE): void {
  ae.project.file = new MockFile(ae, '/projects/demo.aep');
  ae.project.bitsPerChannel = 16;

  const comp = new MockCompItem(1, 'Main', 1920, 1080, 29.97, 12.5);
  const folder = new MockFolderItem(2, 'Assets');
  const footage = new MockFootageItem(3, 'clip.mov', 3840, 2160);
  footage.file = new MockFile(ae, '/footage/clip.mov');
  ae.project.add(comp);
  ae.project.add(folder);
  ae.project.add(footage, folder);

  const transform = new MockPropertyGroup('Transform', 'ADBE Transform Group');
  transform.add(new MockProperty('Position', 'ADBE Position', [100, 200]));
  const opacity = new MockProperty('Opacity', 'ADBE Opacity', 100);
  opacity.key(0, 100);
  opacity.key(12, 0);
  transform.add(opacity);

  const layer = new MockAVLayer('Layer 1', 'Layer');
  layer.id = 7;
  layer.source = comp;
  layer.width = 1920;
  layer.height = 1080;
  layer.add(transform);

  const effects = new MockPropertyGroup('Effects', 'ADBE Effect Parade');
  const blur = new MockEffect('Fast Box Blur', 'ADBE Box Blur2');
  blur.add(new MockProperty('Blur Radius', 'ADBE Box Blur2-0001', 10));
  effects.add(blur);
  layer.add(effects);

  comp.addLayer(layer);
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { value?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

interface Snapshot {
  format: string;
  file: string | null;
  numItems: number;
  bitsPerChannel: number;
  items: Array<{ id: number; type: string; name: string; layers?: unknown[]; file?: string | null }>;
}

describe('project.export_json', () => {
  it('exports only the named or id-matched items when items is given', async () => {
    const { ctx, ae } = await payloadContext();
    seed(ae);

    const snapshot = invoke(ctx, 'project.export_json', { items: ['Main', 3] }).value as Snapshot;

    expect(snapshot.items.map((item) => item.name)).toEqual(['Main', 'clip.mov']);
    expect(snapshot.numItems).toBe(3);
  });

  it('exports the full project structure as a snapshot', async () => {
    const { ctx, ae } = await payloadContext();
    seed(ae);

    const outcome = invoke(ctx, 'project.export_json', null);

    const snapshot = outcome.value as Snapshot;
    expect(snapshot.format).toBe('aemcp-project/v1');
    expect(snapshot.file).toBe('/projects/demo.aep');
    expect(snapshot.bitsPerChannel).toBe(16);
    expect(snapshot.numItems).toBe(3);
    expect(snapshot.items.map((item) => item.type)).toEqual([
      'Composition',
      'Folder',
      'Footage',
    ]);
  });

  it('includes comp settings and every layer with transforms, keyframes and effects', async () => {
    const { ctx, ae } = await payloadContext();
    seed(ae);

    const snapshot = invoke(ctx, 'project.export_json', null).value as Snapshot;
    const comp = snapshot.items.find((item) => item.id === 1);

    expect(comp).toMatchObject({
      type: 'Composition',
      width: 1920,
      height: 1080,
      frameRate: 29.97,
      duration: 12.5,
    });
    expect(comp?.layers).toHaveLength(1);
    const layer = comp?.layers?.[0] as {
      name: string;
      type: string;
      width: number;
      transform?: { properties?: unknown[] };
      effects?: unknown[];
    };
    expect(layer).toMatchObject({ name: 'Layer 1', type: 'AVLayer', width: 1920, height: 1080 });
    expect(layer.transform?.properties).toContainEqual({
      name: 'Position',
      matchName: 'ADBE Position',
      value: [100, 200],
    });
    expect(layer.transform?.properties).toContainEqual({
      name: 'Opacity',
      matchName: 'ADBE Opacity',
      keyframes: [
        { time: 0, value: 100 },
        { time: 12, value: 0 },
      ],
    });
    expect(layer.effects).toEqual([
      {
        name: 'Fast Box Blur',
        matchName: 'ADBE Box Blur2',
        enabled: true,
        properties: [{ name: 'Blur Radius', matchName: 'ADBE Box Blur2-0001', value: 10 }],
      },
    ]);
  });

  it('keeps folder and footage item summaries with the footage file path', async () => {
    const { ctx, ae } = await payloadContext();
    seed(ae);

    const snapshot = invoke(ctx, 'project.export_json', null).value as Snapshot;
    const folder = snapshot.items.find((item) => item.id === 2);
    const footage = snapshot.items.find((item) => item.id === 3);

    expect(folder).toEqual(
      expect.objectContaining({ id: 2, name: 'Assets', type: 'Folder', parentFolderId: 0 }),
    );
    expect(footage).toEqual(
      expect.objectContaining({
        id: 3,
        name: 'clip.mov',
        type: 'Footage',
        parentFolderId: 2,
        file: '/footage/clip.mov',
      }),
    );
  });
});