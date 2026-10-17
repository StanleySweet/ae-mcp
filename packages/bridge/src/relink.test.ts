import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockFileSource, MockFootageItem, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-relink-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value: Record<string, unknown>; issue?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

// Import two footage items, then mark them missing as if their files had moved.
async function missingContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const { ctx, ae } = await payloadContext();
  ae.fs.set('/media/a.mov', '');
  ae.fs.set('/media/b.png', '');
  invoke(ctx, 'project.import_file', { paths: ['/media/a.mov', '/media/b.png'] });
  for (const index of [1, 2]) {
    const item = ae.project.item(index) as MockFootageItem;
    item.file = null;
    item.footageMissing = true;
    item.mainSource = new MockFileSource(null, `/old/${item.name}`);
  }
  return { ctx, ae };
}

describe('footage.relink', () => {
  it('lists flat matches in a dry run and changes nothing', async () => {
    const { ctx, ae } = await missingContext();
    ae.fs.set('/new/a.mov', '');

    const out = invoke(ctx, 'footage.relink', { folder: '/new' });

    expect(out.ok).toBe(true);
    expect(out.value.matches).toEqual([{ id: 1001, name: 'a.mov', path: '/new/a.mov' }]);
    expect(out.value.relinked).toEqual([]);
    expect((ae.project.item(1) as MockFootageItem).footageMissing).toBe(true);
  });

  it('relinks flat matches through footage.replace when apply is true', async () => {
    const { ctx, ae } = await missingContext();
    ae.fs.set('/new/a.mov', '');

    const out = invoke(ctx, 'footage.relink', { folder: '/new', apply: true });

    expect(out.ok).toBe(true);
    expect(out.value.relinked).toEqual([{ id: 1001, name: 'a.mov', path: '/new/a.mov' }]);
    const item = ae.project.item(1) as MockFootageItem;
    expect(item.footageMissing).toBe(false);
    expect(item.file?.path).toBe('/new/a.mov');
  });

  it('searches subfolders only when recursive is true', async () => {
    const { ctx, ae } = await missingContext();
    ae.fs.set('/new/deep/b.png', '');

    const flat = invoke(ctx, 'footage.relink', { folder: '/new' });
    expect(flat.value.matches).toEqual([]);
    expect((flat.value.unmatched as { name: string }[]).map((u) => u.name)).toEqual(['a.mov', 'b.png']);

    const deep = invoke(ctx, 'footage.relink', { folder: '/new', recursive: true, apply: true });
    expect(deep.value.relinked).toEqual([{ id: 1002, name: 'b.png', path: '/new/deep/b.png' }]);
    expect((ae.project.item(2) as MockFootageItem).file?.path).toBe('/new/deep/b.png');
  });

  it('reports a missing item with no matching file as unmatched', async () => {
    const { ctx, ae } = await missingContext();
    ae.fs.set('/new/a.mov', '');

    const out = invoke(ctx, 'footage.relink', { folder: '/new', apply: true });

    expect(out.value.unmatched).toEqual([{ id: 1002, name: 'b.png', missingPath: '/old/b.png' }]);
    expect((ae.project.item(2) as MockFootageItem).footageMissing).toBe(true);
  });

  it('does not relink a name that matches more than one file', async () => {
    const { ctx, ae } = await missingContext();
    ae.fs.set('/new/x/a.mov', '');
    ae.fs.set('/new/y/a.mov', '');

    const out = invoke(ctx, 'footage.relink', { folder: '/new', recursive: true, apply: true });

    expect(out.value.relinked).toEqual([]);
    expect((out.value.ambiguous as { id: number }[]).map((a) => a.id)).toEqual([1001]);
  });

  it('aborts when the folder does not exist', async () => {
    const { ctx } = await missingContext();
    expect(invoke(ctx, 'footage.relink', { folder: '/nowhere' }).ok).toBe(false);
  });
});
