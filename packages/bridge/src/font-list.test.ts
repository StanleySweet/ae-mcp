import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockFontObject, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-font-list-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: unknown; issue?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

describe('font.list', () => {
  // Real AE: app.fonts.allFonts is a list of family groups, each an array of FontObjects.
  it('returns name, family, style and PostScript name for every font, flattened across families', async () => {
    const { ctx, ae } = await payloadContext();
    ae.fontFamilies.push(
      [new MockFontObject('Arial', 'Regular', 'ArialMT'), new MockFontObject('Arial', 'Bold', 'Arial-BoldMT')],
      [new MockFontObject('Helvetica Neue', 'Light', 'HelveticaNeue-Light')],
    );

    const out = invoke(ctx, 'font.list', {});

    expect(out.ok).toBe(true);
    expect(out.value).toEqual({
      fonts: [
        { name: 'Arial Regular', family: 'Arial', style: 'Regular', postScriptName: 'ArialMT' },
        { name: 'Arial Bold', family: 'Arial', style: 'Bold', postScriptName: 'Arial-BoldMT' },
        { name: 'Helvetica Neue Light', family: 'Helvetica Neue', style: 'Light', postScriptName: 'HelveticaNeue-Light' },
      ],
    });
  });

  it('returns an empty list when the font environment has no fonts', async () => {
    const { ctx } = await payloadContext();
    expect(invoke(ctx, 'font.list', {}).value).toEqual({ fonts: [] });
  });
});
