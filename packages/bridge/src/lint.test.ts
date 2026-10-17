import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { build } from './build.js';
import { MockAE, MockAVLayer, MockCompItem, MockFootageItem, MockProperty, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-lint-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

type Finding = {
  item: string;
  rule: string;
  severity: string;
  comp?: string;
  layer?: number;
  fix: { safe: boolean; op?: string; args?: unknown; description?: string } | null;
};

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: { findings: Finding[]; counts: unknown }; issue?: { code: string } } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

/** A project with: a clean layer, a misnamed layer, a layer with a broken expression, an unused footage item and a missing one. */
function seed(ctx: vm.Context, ae: MockAE): void {
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  const comp = ae.project.item(1) as MockCompItem;

  const hero = new MockAVLayer('Hero', 'Hero');
  comp.addLayer(hero);

  const tmp = new MockAVLayer('tmp layer', 'tmp layer');
  comp.addLayer(tmp);

  const broken = new MockAVLayer('Broken', 'Broken');
  const position = new MockProperty('Position', 'ADBE Position', [0, 0]);
  position.expressionEnabled = true;
  position.expression = 'wiggle(';
  position.expressionError = 'Expected ")"';
  broken.add(position);
  comp.addLayer(broken);

  ae.project.add(new MockFootageItem(50, 'unused.mov', 1920, 1080));
  const missing = new MockFootageItem(51, 'gone.mov', 1920, 1080);
  missing.footageMissing = true;
  ae.project.add(missing);
}

describe('project.lint', () => {
  it('reports unused items, missing footage, expression errors and naming violations with severity', async () => {
    const { ctx, ae } = await payloadContext();
    seed(ctx, ae);

    const outcome = invoke(ctx, 'project.lint', { naming: { pattern: '^[A-Z]' } });

    expect(outcome.ok).toBe(true);
    const findings = outcome.value!.findings;
    const byRule = (rule: string): Finding[] => findings.filter((finding) => finding.rule === rule);
    // gone.mov is unused as well as missing, so both rules report it.
    expect(byRule('unused-item')).toEqual([
      expect.objectContaining({ item: 'unused.mov', severity: 'warning' }),
      expect.objectContaining({ item: 'gone.mov', severity: 'warning' }),
    ]);
    expect(byRule('missing-footage')).toEqual([
      expect.objectContaining({ item: 'gone.mov', severity: 'error' }),
    ]);
    expect(byRule('expression-error')).toEqual([
      expect.objectContaining({ item: 'Main / Broken', severity: 'error', comp: 'Main', layer: 3 }),
    ]);
    expect(byRule('naming')).toEqual([
      expect.objectContaining({ item: 'Main / tmp layer', severity: 'warning', layer: 2 }),
    ]);
  });

  it('marks only the naming fix with a rename recipe as safe; everything else is listed, not applied', async () => {
    const { ctx, ae } = await payloadContext();
    seed(ctx, ae);

    const outcome = invoke(ctx, 'project.lint', {
      naming: {
        pattern: '^[A-Z]',
        fix: { match: 'tmp layer', replace: 'Tmp layer', regex: false },
      },
    });

    const findings = outcome.value!.findings;
    const safe = findings.filter((finding) => finding.fix?.safe === true);
    expect(safe).toEqual([
      expect.objectContaining({
        rule: 'naming',
        fix: {
          safe: true,
          description: 'rename with naming.fix',
          op: 'bulk.rename',
          args: { comp: 'Main', layers: [2], match: 'tmp layer', replace: 'Tmp layer', regex: false, flags: '' },
        },
      }),
    ]);
    expect(outcome.value!.counts).toEqual({ total: 5, safeFixes: 1 });
    expect(findings.filter((finding) => finding.rule !== 'naming').every((finding) => finding.fix?.safe === false)).toBe(
      true,
    );
  });

  it('does not change the project', async () => {
    const { ctx, ae } = await payloadContext();
    seed(ctx, ae);
    invoke(ctx, 'project.lint', { naming: { pattern: '^[A-Z]', fix: { match: 'tmp layer', replace: 'Tmp layer' } } });
    expect((ae.project.item(1) as MockCompItem).layer(2)!.name).toBe('tmp layer');
  });

  it('reports nothing for a comp scope with no problems', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Clean', width: 800, height: 600, fps: 24, duration: 5 });
    const comp = ae.project.item(1) as MockCompItem;
    comp.addLayer(new MockAVLayer('Hero', 'Hero'));

    const outcome = invoke(ctx, 'project.lint', { comp: 'Clean', naming: { pattern: '^[A-Z]' } });

    expect(outcome.value).toEqual({ findings: [], counts: { total: 0, safeFixes: 0 } });
  });

  it('refuses an invalid naming pattern', async () => {
    const { ctx, ae } = await payloadContext();
    seed(ctx, ae);
    const outcome = invoke(ctx, 'project.lint', { naming: { pattern: '([' } });
    expect(outcome.issue!.code).toBe('INVALID_ARGS');
  });
});
