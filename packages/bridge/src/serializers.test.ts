import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  compItemSchema,
  itemSummarySchema,
  projectInfoSchema,
} from '@ae-mcp/protocol';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import {
  MockAE,
  MockCompItem,
  MockFolderItem,
  MockFootageItem,
  MockFile,
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
});