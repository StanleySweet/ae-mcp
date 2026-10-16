import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockFolderItem, MockFootageItem, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-import-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  ae.fs.set('/media/a.mov', '');
  ae.fs.set('/media/b.png', '');
  ae.fs.set('/media/c.png', '');
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: { items: { id: number; name: string; type: string }[]; id: number; name: string }; issue?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

describe('project.import_file', () => {
  it('imports several files and returns id, name and type', async () => {
    const { ctx, ae } = await payloadContext();
    const out = invoke(ctx, 'project.import_file', { paths: ['/media/a.mov', '/media/b.png'] });
    expect(out.ok).toBe(true);
    expect(out.value!.items.map((i) =>[i.name, i.type])).toEqual([
      ['a.mov', 'Footage'],
      ['b.png', 'Footage'],
    ]);
    expect(ae.project.numItems).toBe(2);
  });

  it('moves items into a folder, creating it once', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'project.import_file', { path: '/media/a.mov', folder: 'Media' });
    invoke(ctx, 'project.import_file', { path: '/media/b.png', folder: 'Media' });
    const all = Array.from({ length: ae.project.numItems }, (_, i) => ae.project.item(i + 1)!);
    const folders = all.filter((i) => i instanceof MockFolderItem);
    expect(folders).toHaveLength(1);
    expect(folders[0]!.name).toBe('Media');
    expect(all.filter((i) => i instanceof MockFootageItem).map((i) => i.parentFolder.name)).toEqual(['Media', 'Media']);
  });

  it('imports nothing when one file is missing', async () => {
    const { ctx, ae } = await payloadContext();
    const out = invoke(ctx, 'project.import_file', { paths: ['/media/a.mov', '/media/nope.mov'] });
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out.issue)).toContain('/media/nope.mov');
    expect(ae.project.numItems).toBe(0);
  });
});

describe('footage.replace', () => {
  it('replaces by id and by name', async () => {
    const { ctx, ae } = await payloadContext();
    const imported = invoke(ctx, 'project.import_file', { path: '/media/a.mov' }).value!.items[0]!;
    const byId = invoke(ctx, 'footage.replace', { item: imported.id, path: '/media/b.png' });
    expect(byId.value).toEqual({ id: imported.id, name: 'a.mov' });
    expect((ae.project.item(1) as MockFootageItem).file?.path).toBe('/media/b.png');
    const byName = invoke(ctx, 'footage.replace', { item: 'a.mov', path: '/media/c.png' });
    expect(byName.ok).toBe(true);
    expect((ae.project.item(1) as MockFootageItem).file?.path).toBe('/media/c.png');
  });

  it('rejects a missing file or unknown item', async () => {
    const { ctx } = await payloadContext();
    invoke(ctx, 'project.import_file', { path: '/media/a.mov' });
    expect(invoke(ctx, 'footage.replace', { item: 'a.mov', path: '/x.png' }).ok).toBe(false);
    expect(invoke(ctx, 'footage.replace', { item: 'zzz', path: '/media/b.png' }).ok).toBe(false);
  });
});
