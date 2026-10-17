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
  MockProperty,
  MockPropertyGroup,
  runInMockAE,
} from './mock-ae.js';

interface Outcome {
  ok: boolean;
  value?: Record<string, unknown>;
  issue?: { code: string; message: string };
}

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-versions-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  ae.fs.set('/media/a.png', '');
  ae.fs.set('/media/b.png', '');
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): Outcome {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

/** A template comp with a text layer "Title" and a solid layer "Photo". */
function seedTemplate(ae: MockAE): MockCompItem {
  const comp = new MockCompItem(1, 'Template', 1920, 1080, 25, 10);
  ae.project.add(comp);
  ae.project.activeItem = comp;
  // Text layers take their name from the source text, so the placeholder text is 'Title'.
  comp.layers.addText('Title');
  comp.layers.addSolid([1, 0, 0], 'Photo', 1920, 1080, 1, 10);
  return comp;
}

function layerNamed(comp: MockCompItem, layerName: string): MockAVLayer | undefined {
  for (let i = 1; i <= comp.numLayers; i += 1) {
    const layer = comp.layer(i) as MockAVLayer | null;
    if (layer?.name === layerName) return layer;
  }
  return undefined;
}

function textOf(comp: MockCompItem, layerName: string): string | null {
  const layer = layerNamed(comp, layerName);
  const group = layer?.property('ADBE Text Properties') as MockPropertyGroup | null | undefined;
  const prop = group?.property('ADBE Text Document') as MockProperty | null | undefined;
  const value = prop?.value as { text?: string } | undefined;
  return value?.text ?? null;
}

function compNamed(ae: MockAE, name: string): MockCompItem {
  for (let i = 1; i <= ae.project.numItems; i += 1) {
    const item = ae.project.item(i);
    if (item instanceof MockCompItem && item.name === name) return item;
  }
  throw new Error('no comp ' + name);
}

function compNames(ae: MockAE): string[] {
  const names: string[] = [];
  for (let i = 1; i <= ae.project.numItems; i += 1) {
    const item = ae.project.item(i);
    if (item instanceof MockCompItem) names.push(item.name);
  }
  return names;
}

const versions = [
  { name: 'Anna', texts: { Title: 'Hello Anna' }, footage: { Photo: '/media/a.png' } },
  { name: 'Ben', texts: { Title: 'Hello Ben' }, footage: { Photo: '/media/b.png' } },
];

describe('versions.generate', () => {
  it('returns the plan and leaves the project unchanged on a dry run', async () => {
    const { ctx, ae } = await payloadContext();
    const template = seedTemplate(ae);

    const outcome = invoke(ctx, 'versions.generate', { comp: 'Template', versions });

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ dryRun: true });
    expect(outcome.value?.changes).toEqual([
      { name: 'Anna', texts: { Title: 'Hello Anna' }, footage: { Photo: '/media/a.png' } },
      { name: 'Ben', texts: { Title: 'Hello Ben' }, footage: { Photo: '/media/b.png' } },
    ]);
    expect(typeof outcome.value?.fingerprint).toBe('string');
    expect(compNames(ae)).toEqual(['Template']);
    expect(textOf(template, 'Title')).toBe('Title');
  });

  it('duplicates the template per version and replaces text and footage', async () => {
    const { ctx, ae } = await payloadContext();
    const template = seedTemplate(ae);

    const outcome = invoke(ctx, 'versions.generate', { comp: 'Template', versions, dryRun: false });

    expect(outcome.issue).toBeUndefined();
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ dryRun: false, applied: 2 });
    expect(compNames(ae)).toEqual(['Template', 'Anna', 'Ben']);
    const anna = compNamed(ae, 'Anna');
    const ben = compNamed(ae, 'Ben');
    expect(textOf(anna, 'Title')).toBe('Hello Anna');
    expect(textOf(ben, 'Title')).toBe('Hello Ben');
    expect(layerNamed(anna, 'Photo')?.source?.name).toBe('a.png');
    expect(layerNamed(ben, 'Photo')?.source?.name).toBe('b.png');
    expect(textOf(template, 'Title')).toBe('Title');
  });

  it('refuses an unknown layer name with INVALID_ARGS', async () => {
    const { ctx, ae } = await payloadContext();
    seedTemplate(ae);

    const outcome = invoke(ctx, 'versions.generate', {
      comp: 'Template',
      versions: [{ name: 'X', texts: { Missing: 'Hi' } }],
      dryRun: false,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
    expect(compNames(ae)).toEqual(['Template']);
  });

  it('refuses a footage file that does not exist', async () => {
    const { ctx, ae } = await payloadContext();
    seedTemplate(ae);

    const outcome = invoke(ctx, 'versions.generate', {
      comp: 'Template',
      versions: [{ name: 'X', footage: { Photo: '/media/nope.png' } }],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('requires at least one version', async () => {
    const { ctx, ae } = await payloadContext();
    seedTemplate(ae);

    const outcome = invoke(ctx, 'versions.generate', { comp: 'Template', versions: [] });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });
});
