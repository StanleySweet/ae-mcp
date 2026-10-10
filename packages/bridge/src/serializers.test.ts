import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  compItemSchema,
  itemSummarySchema,
  layerSchema,
  projectInfoSchema,
} from '@ae-mcp/protocol';
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
  MockTextLayer,
  runInMockAE,
} from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-serializers-'));
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
  ae.project.add(comp);
  ae.project.add(folder);
  ae.project.add(footage, folder);
  ae.project.activeItem = comp;
}

describe('bridge serializers', () => {
  it('serializes project info with items and active item', async () => {
    const { ctx, ae } = await payloadContext();
    seed(ae);
    const project = projectInfoSchema.parse(vm.runInContext('AEMCP.serialize.project()', ctx));
    expect(project).toMatchObject({
      file: '/projects/demo.aep',
      numItems: 3,
      bitsPerChannel: 16,
      activeItem: { id: 1, name: 'Main', type: 'Composition' },
    });
    expect(project.items.map((item) => item.type)).toEqual([
      'Composition',
      'Folder',
      'Footage',
    ]);
    const footage = project.items.find((item) => item.id === 3);
    expect(footage).toMatchObject({ parentFolderId: 2, parentFolderName: 'Assets' });
  });

  it('serializes a composition item with comp settings', async () => {
    const { ctx, ae } = await payloadContext();
    seed(ae);
    const comp = compItemSchema.parse(
      vm.runInContext('AEMCP.serialize.comp(app.project.item(1))', ctx),
    );
    expect(comp).toMatchObject({
      id: 1,
      name: 'Main',
      type: 'Composition',
      parentFolderId: 0,
      width: 1920,
      height: 1080,
      frameRate: 29.97,
      duration: 12.5,
      numLayers: 0,
      bgColor: [0, 0, 0],
      motionBlur: false,
    });
  });

  it('serializes a folder as an item summary', async () => {
    const { ctx, ae } = await payloadContext();
    seed(ae);
    const folder = itemSummarySchema.parse(
      vm.runInContext('AEMCP.serialize.item(app.project.item(2))', ctx),
    );
    expect(folder).toMatchObject({ id: 2, name: 'Assets', type: 'Folder' });
  });

  it('serializes a layer with transform, keyframes, effects, masks and text', async () => {
    const { ctx, ae } = await payloadContext();
    seed(ae);
    const comp = ae.project.item(1) as MockCompItem;

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

    const masks = new MockPropertyGroup('Masks', 'ADBE Mask Parade');
    masks.add(new MockProperty('Mask 1', 'ADBE Mask Atom'));
    layer.add(masks);

    const text = new MockTextLayer('Title', 'Layer');
    text.id = 8;
    const textProperties = new MockPropertyGroup('Text', 'ADBE Text Properties');
    textProperties.add(
      new MockProperty('Source Text', 'ADBE Text Document', {
        text: 'Hello',
        fontSize: 72,
        font: 'ArialMT',
        fillColor: [1, 1, 1],
      }),
    );
    text.add(textProperties);

    comp.addLayer(layer);
    comp.addLayer(text);

    const avLayer = layerSchema.parse(
      vm.runInContext('AEMCP.serialize.layer(app.project.item(1).layer(1))', ctx),
    );
    expect(avLayer).toMatchObject({
      index: 1,
      id: 7,
      name: 'Layer 1',
      type: 'AVLayer',
      width: 1920,
      height: 1080,
      sourceId: 1,
      sourceName: 'Main',
      parentIndex: null,
    });
    expect(avLayer.transform?.properties).toContainEqual({
      name: 'Position',
      matchName: 'ADBE Position',
      value: [100, 200],
    });
    expect(avLayer.transform?.properties).toContainEqual({
      name: 'Opacity',
      matchName: 'ADBE Opacity',
      keyframes: [
        { time: 0, value: 100 },
        { time: 12, value: 0 },
      ],
    });
    expect(avLayer.effects).toEqual([
      {
        name: 'Fast Box Blur',
        matchName: 'ADBE Box Blur2',
        enabled: true,
        properties: [{ name: 'Blur Radius', matchName: 'ADBE Box Blur2-0001', value: 10 }],
      },
    ]);
    expect(avLayer.masks).toHaveLength(1);

    const textLayer = layerSchema.parse(
      vm.runInContext('AEMCP.serialize.layer(app.project.item(1).layer(2))', ctx),
    );
    expect(textLayer).toMatchObject({
      name: 'Title',
      type: 'TextLayer',
      text: { text: 'Hello', fontSize: 72, font: 'ArialMT', fillColor: [1, 1, 1] },
    });
  });

  it('resolves ae_layer_info by comp name, all layers or an index subset', async () => {
    const { ctx, ae } = await payloadContext();
    seed(ae);
    const comp = ae.project.item(1) as MockCompItem;
    const first = new MockAVLayer('Layer 1', 'Layer');
    first.id = 7;
    const second = new MockAVLayer('Layer 2', 'Layer');
    second.id = 8;
    comp.addLayer(first);
    comp.addLayer(second);

    const all = vm.runInContext("AEMCP.invoke('ae_layer_info', { comp: 'Main' }, null).value", ctx);
    expect(all.comp).toBe('Main');
    expect(all.layers.map((layer: { name: string }) => layer.name)).toEqual([
      'Layer 1',
      'Layer 2',
    ]);

    const subset = vm.runInContext(
      "AEMCP.invoke('ae_layer_info', { comp: 'Main', layers: [2, 9] }, null).value",
      ctx,
    );
    expect(subset.layers.map((layer: { name: string }) => layer.name)).toEqual(['Layer 2']);
    expect(subset.missing).toEqual([9]);

    const unknown = vm.runInContext(
      "AEMCP.invoke('ae_layer_info', { comp: 'Nope' }, null).value",
      ctx,
    );
    expect(unknown.comp).toBeNull();
  });
});