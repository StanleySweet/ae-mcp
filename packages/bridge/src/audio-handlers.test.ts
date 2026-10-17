import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockAVLayer, MockCompItem, MockProperty, MockPropertyGroup, runInMockAE } from './mock-ae.js';

// fr_FR display names, so a lookup by English display name fails here as on
// a French After Effects (#257).
async function audioLayerContext(): Promise<{ ctx: vm.Context; levels: MockProperty; layer: MockAVLayer }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-audio-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  vm.runInContext(`AEMCP.invoke('comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 }, null)`, ctx);
  const layer = new MockAVLayer('Tone', 'Layer');
  layer.hasAudio = true;
  const audio = layer.add(new MockPropertyGroup('Audio', 'ADBE Audio Group'));
  const levels = audio.add(new MockProperty('Niveaux audio', 'ADBE Audio Levels', [0, 0]));
  (ae.project.item(1) as MockCompItem).addLayer(layer);
  return { ctx, levels, layer };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: unknown; issue?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

describe('audio ops by match name', () => {
  it('audio.set_levels sets ADBE Audio Levels', async () => {
    const { ctx, levels } = await audioLayerContext();

    const out = invoke(ctx, 'audio.set_levels', { comp: 'Main', layerIndex: 1, levels: [-6, -6] });

    expect(out.ok).toBe(true);
    expect(levels.value).toEqual([-6, -6]);
  });

  it('audio.info reads the levels', async () => {
    const { ctx, levels } = await audioLayerContext();
    levels.setValue([-3, -3]);

    const out = invoke(ctx, 'audio.info', { comp: 'Main', layerIndex: 1 });

    expect(out).toMatchObject({ ok: true, value: { hasAudio: true, levels: [-3, -3] } });
  });
});
