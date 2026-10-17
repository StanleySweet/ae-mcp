import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockAVLayer, MockCompItem, MockProperty, MockPropertyGroup, runInMockAE } from './mock-ae.js';

interface Outcome {
  ok: boolean;
  value?: {
    changes: { comp: string; index: number; oldText: string; newText: string; fontSize: number }[];
    unfit: { comp: string; index: number; fontSize: number }[];
  };
  issue?: { code: string; message: string };
}

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-localize-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): Outcome {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

function textDocOf(layer: MockAVLayer): MockProperty {
  const group = layer.property('ADBE Text Properties') as MockPropertyGroup;
  return group.property('ADBE Text Document') as MockProperty;
}

/** A comp with three text layers at 50 pt: "Hello World" (room for a longer text), "Hi" and "Yo" (tight). */
function seedLocalizeComp(ae: MockAE): MockCompItem {
  const comp = new MockCompItem(1, 'Main', 1920, 1080, 25, 10);
  ae.project.add(comp);
  ae.project.activeItem = comp;
  for (const text of ['Hello World', 'Hi', 'Yo']) {
    const layer = comp.layers.addText(text);
    const prop = textDocOf(layer);
    const doc = prop.value as { fontSize: number };
    doc.fontSize = 50;
    prop.setValue(doc);
  }
  return comp;
}

function layerTexts(comp: MockCompItem): { text: string; fontSize: number }[] {
  const out: { text: string; fontSize: number }[] = [];
  for (let i = 1; i <= comp.numLayers; i += 1) {
    const doc = textDocOf(comp.layer(i) as MockAVLayer).value as { text: string; fontSize: number };
    out.push({ text: doc.text, fontSize: doc.fontSize });
  }
  return out;
}

describe('localize.apply', () => {
  it('replaces text and keeps the font size when the translation fits the box', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedLocalizeComp(ae);

    const outcome = invoke(ctx, 'localize.apply', {
      comps: ['Main'],
      table: { 'Hello World': 'Hola mundo' },
    });

    expect(outcome.issue).toBeUndefined();
    expect(outcome.ok).toBe(true);
    expect(outcome.value?.changes).toEqual([
      { comp: 'Main', index: 1, oldText: 'Hello World', newText: 'Hola mundo', fontSize: 50 },
    ]);
    expect(outcome.value?.unfit).toEqual([]);
    expect(layerTexts(comp)[0]).toEqual({ text: 'Hola mundo', fontSize: 50 });
  });

  it('shrinks the font until a longer translation fits its original box', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedLocalizeComp(ae);

    const outcome = invoke(ctx, 'localize.apply', {
      comps: ['Main'],
      table: { Hi: 'Hello there' },
    });

    expect(outcome.ok).toBe(true);
    // "Hi" at 50 pt is 50 px wide in the mock model; "Hello there" fits at 9 pt (49.5 px).
    expect(outcome.value?.changes).toEqual([
      { comp: 'Main', index: 2, oldText: 'Hi', newText: 'Hello there', fontSize: 9 },
    ]);
    expect(layerTexts(comp)[1]).toEqual({ text: 'Hello there', fontSize: 9 });
  });

  it('reports a text that cannot fit even at the minimum size and leaves it there', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedLocalizeComp(ae);

    const outcome = invoke(ctx, 'localize.apply', {
      comps: ['Main'],
      table: { Yo: 'Extraordinarily long translation' },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.value?.unfit).toEqual([{ comp: 'Main', index: 3, fontSize: 8 }]);
    expect(layerTexts(comp)[2]).toEqual({ text: 'Extraordinarily long translation', fontSize: 8 });
  });

  it('refuses an empty table', async () => {
    const { ctx, ae } = await payloadContext();
    seedLocalizeComp(ae);

    const outcome = invoke(ctx, 'localize.apply', { comps: ['Main'], table: {} });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });
});
