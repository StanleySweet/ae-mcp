import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockFolderItem, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE; home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-housekeeping-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae, home };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: unknown; issue?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

function projectNames(ae: MockAE): string[] {
  const out: string[] = [];
  for (let i = 1; i <= ae.project.numItems; i++) {
    out.push(ae.project.item(i)!.name);
  }
  return out;
}

function footageInFolder(ae: MockAE, folder: string): string[] {
  const out: string[] = [];
  for (let i = 1; i <= ae.project.numItems; i++) {
    const item = ae.project.item(i)!;
    if (item.parentFolder?.name === folder && !(item instanceof MockFolderItem)) {
      out.push(item.name);
    }
  }
  return out.sort();
}

describe('project housekeeping handlers', () => {
  describe('project.import_folder', () => {
    async function withShots(): Promise<{ ctx: vm.Context; ae: MockAE; dir: string }> {
      const { ctx, ae, home } = await payloadContext();
      const dir = join(home, 'shots');
      ae.fs.set(join(dir, 'a.png'), 'PNG');
      ae.fs.set(join(dir, 'b.png'), 'PNG');
      ae.fs.set(join(dir, '.hidden.png'), 'PNG');
      ae.fs.set(join(dir, 'sub', 'c.png'), 'PNG');
      return { ctx, ae, dir };
    }

    it('imports every visible file into a folder named after the source folder', async () => {
      const { ctx, ae, dir } = await withShots();
      const out = invoke(ctx, 'project.import_folder', { path: dir, recursive: false });
      expect(out.ok).toBe(true);
      const value = out.value as { items: Array<{ name: string; type: string }>; skipped: unknown[] };
      expect(value.items.map((item) => item.name).sort()).toEqual(['a.png', 'b.png']);
      expect(value.skipped).toEqual([]);
      expect(projectNames(ae)).toContain('shots');
      expect(footageInFolder(ae, 'shots')).toEqual(['a.png', 'b.png']);
    });

    it('skips hidden files and does not recurse by default', async () => {
      const { ctx, dir } = await withShots();
      const value = invoke(ctx, 'project.import_folder', { path: dir }).value as { items: Array<{ name: string }> };
      expect(value.items.map((item) => item.name)).not.toContain('.hidden.png');
      expect(value.items.map((item) => item.name)).not.toContain('c.png');
    });

    it('recurses into sub-folders when recursive is true', async () => {
      const { ctx, dir } = await withShots();
      const value = invoke(ctx, 'project.import_folder', { path: dir, recursive: true }).value as {
        items: Array<{ name: string }>;
      };
      expect(value.items.map((item) => item.name).sort()).toEqual(['a.png', 'b.png', 'c.png']);
    });

    it('uses the folder argument as the project folder name', async () => {
      const { ctx, ae, dir } = await withShots();
      invoke(ctx, 'project.import_folder', { path: dir, folder: 'Renders' });
      expect(footageInFolder(ae, 'Renders')).toEqual(['a.png', 'b.png']);
    });

    it('collects files AE refuses into skipped instead of aborting', async () => {
      const { ctx, ae, dir } = await withShots();
      const original = ae.project.importFile.bind(ae.project);
      vi.spyOn(ae.project, 'importFile').mockImplementation((options) => {
        if (options.file?.name === 'b.png') {
          throw new Error('unsupported format');
        }
        return original(options);
      });
      const value = invoke(ctx, 'project.import_folder', { path: dir }).value as {
        items: Array<{ name: string }>;
        skipped: Array<{ path: string; reason: string }>;
      };
      expect(value.items.map((item) => item.name)).toEqual(['a.png']);
      expect(value.skipped).toEqual([{ path: join(dir, 'b.png'), reason: 'unsupported format' }]);
    });

    it('aborts with INVALID_ARGS when the folder does not exist', async () => {
      const { ctx } = await payloadContext();
      const out = invoke(ctx, 'project.import_folder', { path: '/nonexistent/ae-mcp' });
      expect(out.ok).toBe(false);
      expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'folder not found: /nonexistent/ae-mcp' });
    });
  });

  describe('project.reduce', () => {
    it('aborts with INVALID_ARGS when a comp is missing', async () => {
      const { ctx, ae } = await payloadContext();
      ae.project.items.addComp('Main', 800, 600, 1, 5);
      const out = invoke(ctx, 'project.reduce', { items: ['Main', 'Missing'] });
      expect(out.ok).toBe(false);
      expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'composition not found: Missing' });
    });

    it('aborts when an item is not a composition', async () => {
      const { ctx, ae } = await payloadContext();
      ae.project.items.addFolder('Bin');
      const out = invoke(ctx, 'project.reduce', { items: ['Bin'] });
      expect(out.ok).toBe(false);
      expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'not a composition: Bin' });
    });

    it('calls reduceProject with the resolved comps, by id and by name', async () => {
      const { ctx, ae } = await payloadContext();
      const main = ae.project.items.addComp('Main', 800, 600, 1, 5) as MockCompItem;
      const other = ae.project.items.addComp('Other', 800, 600, 1, 5) as MockCompItem;
      ae.project.items.addComp('Unused', 800, 600, 1, 5);
      const spy = vi.spyOn(ae.project, 'reduceProject');
      const out = invoke(ctx, 'project.reduce', { items: [main.id, 'Other'] });
      expect(out.ok).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0]).toEqual([main, other]);
      expect(out.value).toMatchObject({ removed: 1, numItems: 2 });
    });
  });

  describe('project.consolidate_footage', () => {
    it('calls consolidateFootage on the project', async () => {
      const { ctx, ae } = await payloadContext();
      const spy = vi.spyOn(ae.project, 'consolidateFootage');
      const out = invoke(ctx, 'project.consolidate_footage', {});
      expect(out.ok).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(out.value).toMatchObject({ removed: 0, numItems: 0 });
    });
  });
});
