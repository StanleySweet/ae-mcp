import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockVectorsGroup, runInMockAE } from './mock-ae.js';

// Match names copied from the scripting guide. AE 26.5 segfaults when
// addProperty gets a name it does not know, so every match name the bridge uses
// must appear here, and adding one means checking the guide first.
// Ref: https://ae-scripting.docsforadobe.dev/matchnames/layer/avlayer/
// Ref: https://ae-scripting.docsforadobe.dev/matchnames/layer/shapelayer/
// Ref: https://ae-scripting.docsforadobe.dev/matchnames/layer/textlayer/
// Ref: https://ae-scripting.docsforadobe.dev/matchnames/effects/firstparty/
const DOCUMENTED = new Set([
  'ADBE Transform Group',
  'ADBE Anchor Point',
  'ADBE Position',
  'ADBE Scale',
  'ADBE Rotate Z',
  'ADBE Opacity',
  'ADBE Effect Parade',
  'ADBE Mask Parade',
  'ADBE Marker',
  'ADBE Audio Group',
  'ADBE Audio Levels',
  'ADBE Text Properties',
  'ADBE Text Document',
  'ADBE Slider Control',
  'ADBE Root Vectors Group',
  'ADBE Vector Group',
  'ADBE Vectors Group',
  'ADBE Vector Shape - Group',
  'ADBE Vector Shape',
  'ADBE Vector Shape - Rect',
  'ADBE Vector Rect Size',
  'ADBE Vector Shape - Ellipse',
  'ADBE Vector Ellipse Size',
  'ADBE Vector Graphic - Fill',
  'ADBE Vector Fill Color',
  'ADBE Vector Graphic - Stroke',
  'ADBE Vector Stroke Color',
  'ADBE Vector Stroke Width',
  'ADBE Vector Rect Position',
  'ADBE Vector Ellipse Position',
  'ADBE Vector Fill Opacity',
  'ADBE Vector Stroke Opacity',
  'ADBE Vector Transform Group',
  'ADBE Vector Position',
  'ADBE Vector Scale',
  'ADBE Vector Rotation',
  'ADBE Vector Group Opacity',
  'ADBE Glo2',
  'ADBE Gaussian Blur 2',
  'ADBE Noise',
  'ADBE Drop Shadow',
  'CS Vignette',
  // #225 effects on the guide's first-party page (Transition, Color Correction, Distort).
  'ADBE Linear Wipe',
  'ADBE Tint',
  'ADBE Turbulent Displace',
  'ADBE Brightness & Contrast 2',
]);

// Match names the scripting guide does not list, read from live AE instead
// (ae_layer_info on fr_FR AE 26.5, docs/findings/2026-10-16-shape-path-matchname-crash.md).
// Only add to this list after reading the name back from a running AE.
// #225: effect parameter match names from the probe in
// docs/findings/2026-10-17-effect-param-matchnames.md.
const READ_FROM_LIVE_AE = new Set([
  'ADBE Mask Atom',
  'ADBE Mask Shape',
  'ADBE Linear Wipe-0001',
  'ADBE Glo2-0002',
  'ADBE Glo2-0003',
  'ADBE Glo2-0004',
  'ADBE Gaussian Blur 2-0001',
  'ADBE Noise-0001',
  'ADBE Drop Shadow-0002',
  'ADBE Drop Shadow-0004',
  'ADBE Drop Shadow-0005',
  'CS Vignette-0001',
  'ADBE Tint-0001',
  'ADBE Tint-0002',
  'ADBE Tint-0003',
  'ADBE Turbulent Displace-0002',
  'ADBE Brightness & Contrast 2-0001',
  'ADBE Brightness & Contrast 2-0002',
]);

const BRIDGE_SOURCES = ['job-runner.js', 'serializers.js', 'handlers.js', 'handlers-relink.js', 'handlers-project.js', 'handlers-eval.js', 'handlers-layers.js', 'handlers-housekeeping.js', 'handlers-verify.js', 'handlers-templates.js', 'handlers-lint.js', 'handlers-errors.js', 'handlers-versions.js', 'handlers-mogrt.js', 'handlers-audio.js', 'handlers-localize.js', 'handlers-animate.js'];

function source(file: string): string {
  return readFileSync(join(import.meta.dirname, file), 'utf8');
}

function matchTable(): Record<string, string> {
  const handlers = source('handlers.js');
  const block = /var AEMCP_MATCH = \{([\s\S]*?)\};/.exec(handlers);
  if (!block) throw new Error('AEMCP_MATCH table not found in handlers.js');
  const table: Record<string, string> = {};
  for (const entry of block[1].matchAll(/(\w+): '([^']+)'/g)) {
    table[entry[1]] = entry[2];
  }
  return table;
}

describe('AEMCP_MATCH', () => {
  it('holds only match names documented in the scripting guide or read from live AE', () => {
    const undocumented = Object.values(matchTable()).filter(
      (name) => !DOCUMENTED.has(name) && !READ_FROM_LIVE_AE.has(name),
    );
    expect(undocumented).toEqual([]);
  });

  it('is the only place the bridge writes an ADBE match-name literal', () => {
    const strays: string[] = [];
    for (const file of BRIDGE_SOURCES) {
      const code = source(file).replace(/var AEMCP_MATCH = \{[\s\S]*?\};/, '');
      code.split('\n').forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;
        for (const literal of line.matchAll(/'(ADBE [^']*)'/g)) {
          strays.push(`${file}:${i + 1} ${literal[1]}`);
        }
      });
    }
    expect(strays).toEqual([]);
  });
});

describe('aemcpAddProperty', () => {
  it('refuses a match name the group cannot hold, before calling addProperty', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ae-mcp-match-'));
    const ae = new MockAE();
    ae.env.HOME = home;
    const outDir = join(home, 'built');
    await build({ outDir });
    const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
    const group = new MockVectorsGroup('Contents', 'ADBE Vectors Group');
    ctx.group = group;

    const issue = vm.runInContext(
      `(function () { try { aemcpAddProperty(group, 'ADBE Vector Shape - Path'); return null; } catch (e) { return e.aemcpIssue; } })()`,
      ctx,
    );

    expect(issue).toMatchObject({ code: 'INVALID_ARGS' });
    expect(group.numProperties).toBe(0);
  });
});
