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
  MockLayer,
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
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-e9-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): Outcome {
  vm.runInContext(`var __args = ${JSON.stringify(args)};`, ctx);
  const json = vm.runInContext(
    `JSON.stringify(AEMCP.invoke(${JSON.stringify(tool)}, __args, 9999999999999))`,
    ctx,
  ) as string;
  return JSON.parse(json) as Outcome;
}

function seedComp(ae: MockAE, names: string[]): MockCompItem {
  const comp = new MockCompItem(1, 'Main', 1920, 1080, 25, 10);
  ae.project.add(comp);
  ae.project.activeItem = comp;
  for (const name of names) {
    comp.addLayer(new MockAVLayer(name, 'Layer'));
  }
  return comp;
}

describe('bulk.rename', () => {
  it('previews changes by default and leaves the layers untouched', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Layer 1', 'Layer 2']);

    const outcome = invoke(ctx, 'bulk.rename', { comp: 'Main', match: 'Layer', replace: 'Element' });

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ dryRun: true, comp: 'Main' });
    expect(outcome.value?.changes).toEqual([
      { index: 1, from: 'Layer 1', to: 'Element 1' },
      { index: 2, from: 'Layer 2', to: 'Element 2' },
    ]);
    expect(typeof outcome.value?.fingerprint).toBe('string');
    expect(comp.layer(1)!.name).toBe('Layer 1');
    expect(comp.layer(2)!.name).toBe('Layer 2');
  });

  it('renames the layers when dryRun is false', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Layer 1', 'Layer 2']);

    const outcome = invoke(ctx, 'bulk.rename', {
      comp: 'Main',
      match: 'Layer',
      replace: 'Element',
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ dryRun: false, applied: 2 });
    expect(comp.layer(1)!.name).toBe('Element 1');
    expect(comp.layer(2)!.name).toBe('Element 2');
  });

  it('renames by regular expression with capture groups', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['foo_01', 'foo_02']);

    const outcome = invoke(ctx, 'bulk.rename', {
      comp: 'Main',
      match: 'foo_(\\d+)',
      replace: 'bar_$1',
      regex: true,
      dryRun: false,
    });

    expect(outcome.value?.changes).toEqual([
      { index: 1, from: 'foo_01', to: 'bar_01' },
      { index: 2, from: 'foo_02', to: 'bar_02' },
    ]);
    expect(comp.layer(1)!.name).toBe('bar_01');
    expect(comp.layer(2)!.name).toBe('bar_02');
  });

  it('adds a prefix and a suffix', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['A', 'B']);

    invoke(ctx, 'bulk.rename', { comp: 'Main', prefix: 'X_', suffix: '_1', dryRun: false });

    expect(comp.layer(1)!.name).toBe('X_A_1');
    expect(comp.layer(2)!.name).toBe('X_B_1');
  });

  it('applies numbering with padding and step over the targets', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Node', 'Node']);

    invoke(ctx, 'bulk.rename', {
      comp: 'Main',
      numbering: { start: 1, step: 2, padding: 2 },
      dryRun: false,
    });

    expect(comp.layer(1)!.name).toBe('Node01');
    expect(comp.layer(2)!.name).toBe('Node03');
  });

  it('numbered prefixes go in front of the name', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Shot']);

    invoke(ctx, 'bulk.rename', {
      comp: 'Main',
      numbering: { position: 'prefix', start: 5, padding: 3 },
      dryRun: false,
    });

    expect(comp.layer(1)!.name).toBe('005Shot');
  });

  it('limits the rename to the requested layers', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Layer 1', 'Layer 2']);

    const outcome = invoke(ctx, 'bulk.rename', {
      comp: 'Main',
      layers: [2],
      match: 'Layer',
      replace: 'X',
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ applied: 1 });
    expect(outcome.value?.changes).toEqual([{ index: 2, from: 'Layer 2', to: 'X 2' }]);
    expect(comp.layer(1)!.name).toBe('Layer 1');
    expect(comp.layer(2)!.name).toBe('X 2');
  });

  it('changes the fingerprint when a target name changes', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['Layer 1']);

    const before = invoke(ctx, 'bulk.rename', { comp: 'Main', match: 'Layer', replace: 'E' }).value
      ?.fingerprint;
    invoke(ctx, 'bulk.rename', { comp: 'Main', match: 'Layer', replace: 'E', dryRun: false });
    const after = invoke(ctx, 'bulk.rename', { comp: 'Main', match: 'Layer', replace: 'E' }).value
      ?.fingerprint;

    expect(after).not.toBe(before);
  });

  it('requires a rename source', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['Layer 1']);

    const outcome = invoke(ctx, 'bulk.rename', { comp: 'Main' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('rejects an invalid regular expression', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['Layer 1']);

    const outcome = invoke(ctx, 'bulk.rename', { comp: 'Main', match: '(', regex: true });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('reports a composition that does not exist', async () => {
    const { ctx } = await payloadContext();

    const outcome = invoke(ctx, 'bulk.rename', { comp: 'Nope', prefix: 'x' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
    expect(outcome.issue?.message).toContain('Nope');
  });
});

function seedPositionComp(
  ae: MockAE,
  id: number,
  name: string,
  positions: unknown[][],
): MockCompItem {
  const comp = new MockCompItem(id, name, 1920, 1080, 25, 10);
  ae.project.add(comp);
  positions.forEach((position) => {
    const layer = new MockAVLayer('Layer', 'Layer');
    const transform = new MockPropertyGroup('Transform', 'ADBE Transform Group');
    transform.add(new MockProperty('Position', 'ADBE Position', position));
    layer.add(transform);
    comp.addLayer(layer);
  });
  return comp;
}

function positionAt(comp: MockCompItem, index: number): unknown {
  const layer = comp.layer(index);
  const group = layer?.property('ADBE Transform Group');
  const prop = (group as MockPropertyGroup | null)?.property('ADBE Position');
  return (prop as MockProperty | null)?.value;
}

describe('bulk.set_property', () => {
  it('previews changes by default and leaves the values untouched', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedPositionComp(ae, 1, 'Main', [
      [0, 0],
      [10, 10],
    ]);
    ae.project.activeItem = comp;

    const outcome = invoke(ctx, 'bulk.set_property', {
      comp: 'Main',
      property: 'ADBE Transform Group/ADBE Position',
      value: [100, 200],
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({
      dryRun: true,
      property: 'ADBE Transform Group/ADBE Position',
    });
    expect(outcome.value?.changes).toEqual([
      { comp: 'Main', index: 1, from: [0, 0], to: [100, 200] },
      { comp: 'Main', index: 2, from: [10, 10], to: [100, 200] },
    ]);
    expect(typeof outcome.value?.fingerprint).toBe('string');
    expect(positionAt(comp, 1)).toEqual([0, 0]);
    expect(positionAt(comp, 2)).toEqual([10, 10]);
  });

  it('sets the property when dryRun is false', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedPositionComp(ae, 1, 'Main', [
      [0, 0],
      [10, 10],
    ]);
    ae.project.activeItem = comp;

    const outcome = invoke(ctx, 'bulk.set_property', {
      comp: 'Main',
      property: 'Position',
      value: [5, 6],
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ dryRun: false, applied: 2 });
    expect(positionAt(comp, 1)).toEqual([5, 6]);
    expect(positionAt(comp, 2)).toEqual([5, 6]);
  });

  it('omits targets that already hold the value', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedPositionComp(ae, 1, 'Main', [
      [1, 1],
      [2, 2],
    ]);
    ae.project.activeItem = comp;

    const outcome = invoke(ctx, 'bulk.set_property', {
      comp: 'Main',
      property: 'Position',
      value: [1, 1],
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ applied: 1 });
    expect(outcome.value?.changes).toEqual([
      { comp: 'Main', index: 2, from: [2, 2], to: [1, 1] },
    ]);
  });

  it('skips layers that have no such property', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Plain']);

    const outcome = invoke(ctx, 'bulk.set_property', {
      comp: 'Main',
      property: 'Position',
      value: [1, 1],
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.value?.changes).toEqual([]);
    expect(outcome.value?.skipped).toEqual([{ comp: 'Main', index: 1 }]);
    expect(comp.layer(1)!.name).toBe('Plain');
  });

  it('applies across several comps', async () => {
    const { ctx, ae } = await payloadContext();
    const main = seedPositionComp(ae, 1, 'Main', [[0, 0]]);
    const second = seedPositionComp(ae, 2, 'Second', [[0, 0]]);
    ae.project.activeItem = main;

    const outcome = invoke(ctx, 'bulk.set_property', {
      comps: ['Main', 'Second'],
      property: 'Position',
      value: [9, 9],
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ applied: 2 });
    expect(positionAt(main, 1)).toEqual([9, 9]);
    expect(positionAt(second, 1)).toEqual([9, 9]);
  });

  it('limits the change to the requested layers', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedPositionComp(ae, 1, 'Main', [
      [0, 0],
      [0, 0],
    ]);
    ae.project.activeItem = comp;

    const outcome = invoke(ctx, 'bulk.set_property', {
      comp: 'Main',
      layers: [2],
      property: 'Position',
      value: [7, 7],
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ applied: 1 });
    expect(positionAt(comp, 1)).toEqual([0, 0]);
    expect(positionAt(comp, 2)).toEqual([7, 7]);
  });

  it('changes the fingerprint when a target value changes', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedPositionComp(ae, 1, 'Main', [[0, 0]]);
    ae.project.activeItem = comp;

    const before = invoke(ctx, 'bulk.set_property', {
      comp: 'Main',
      property: 'Position',
      value: [3, 3],
    }).value?.fingerprint;
    invoke(ctx, 'bulk.set_property', {
      comp: 'Main',
      property: 'Position',
      value: [3, 3],
      dryRun: false,
    });
    const after = invoke(ctx, 'bulk.set_property', {
      comp: 'Main',
      property: 'Position',
      value: [3, 3],
    }).value?.fingerprint;

    expect(after).not.toBe(before);
  });

  it('requires a property name', async () => {
    const { ctx, ae } = await payloadContext();
    seedPositionComp(ae, 1, 'Main', [[0, 0]]);

    const outcome = invoke(ctx, 'bulk.set_property', { comp: 'Main', value: [1, 1] });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('requires a value', async () => {
    const { ctx, ae } = await payloadContext();
    seedPositionComp(ae, 1, 'Main', [[0, 0]]);

    const outcome = invoke(ctx, 'bulk.set_property', { comp: 'Main', property: 'Position' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('reports a composition that does not exist', async () => {
    const { ctx } = await payloadContext();

    const outcome = invoke(ctx, 'bulk.set_property', {
      comp: 'Nope',
      property: 'Position',
      value: [1, 1],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
    expect(outcome.issue?.message).toContain('Nope');
  });
});

function effectsOf(comp: MockCompItem, index: number): string[] {
  const layer = comp.layer(index);
  const parade = layer?.property('ADBE Effect Parade');
  if (!(parade instanceof MockPropertyGroup)) {
    return [];
  }
  const names: string[] = [];
  for (let i = 1; i <= parade.numProperties; i += 1) {
    names.push(parade.property(i)!.matchName);
  }
  return names;
}

function positionProperty(comp: MockCompItem, index: number): MockProperty | null {
  const layer = comp.layer(index);
  const group = layer?.property('ADBE Transform Group');
  return ((group as MockPropertyGroup | null)?.property('ADBE Position') as MockProperty | null) ?? null;
}

function presetsOf(comp: MockCompItem, index: number): string[] {
  return (comp.layer(index) as MockLayer | null)?.presets ?? [];
}

describe('bulk.apply_effect', () => {
  it('previews the layer selection by default without adding effects', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Layer 1', 'Layer 2']);

    const outcome = invoke(ctx, 'bulk.apply_effect', { comp: 'Main', effect: 'ADBE Box Blur2' });

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ dryRun: true, effect: 'ADBE Box Blur2' });
    expect(outcome.value?.changes).toEqual([
      { index: 1, effect: 'ADBE Box Blur2' },
      { index: 2, effect: 'ADBE Box Blur2' },
    ]);
    expect(typeof outcome.value?.fingerprint).toBe('string');
    expect(effectsOf(comp, 1)).toEqual([]);
    expect(effectsOf(comp, 2)).toEqual([]);
  });

  it('adds the effect to each layer when dryRun is false', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Layer 1', 'Layer 2']);

    const outcome = invoke(ctx, 'bulk.apply_effect', {
      comp: 'Main',
      effect: 'ADBE Box Blur2',
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ dryRun: false, applied: 2 });
    expect(effectsOf(comp, 1)).toEqual(['ADBE Box Blur2']);
    expect(effectsOf(comp, 2)).toEqual(['ADBE Box Blur2']);
  });

  it('skips layers that already carry the effect', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['Layer 1', 'Layer 2']);
    invoke(ctx, 'bulk.apply_effect', {
      comp: 'Main',
      layers: [1],
      effect: 'ADBE Box Blur2',
      dryRun: false,
    });

    const outcome = invoke(ctx, 'bulk.apply_effect', { comp: 'Main', effect: 'ADBE Box Blur2' });

    expect(outcome.value?.changes).toEqual([{ index: 2, effect: 'ADBE Box Blur2' }]);
    expect(outcome.value?.skipped).toEqual([{ index: 1, reason: 'present' }]);
  });

  it('limits the change to the requested layers', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Layer 1', 'Layer 2']);

    invoke(ctx, 'bulk.apply_effect', {
      comp: 'Main',
      layers: [2],
      effect: 'ADBE Box Blur2',
      dryRun: false,
    });

    expect(effectsOf(comp, 1)).toEqual([]);
    expect(effectsOf(comp, 2)).toEqual(['ADBE Box Blur2']);
  });

  it('requires an effect name', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['Layer 1']);

    const outcome = invoke(ctx, 'bulk.apply_effect', { comp: 'Main' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('reports a composition that does not exist', async () => {
    const { ctx } = await payloadContext();

    const outcome = invoke(ctx, 'bulk.apply_effect', { comp: 'Nope', effect: 'ADBE Box Blur2' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
    expect(outcome.issue?.message).toContain('Nope');
  });
});

describe('bulk.set_expression', () => {
  it('previews expression changes by default and leaves the property untouched', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedPositionComp(ae, 1, 'Main', [[0, 0]]);
    ae.project.activeItem = comp;

    const outcome = invoke(ctx, 'bulk.set_expression', {
      comp: 'Main',
      property: 'Position',
      expression: 'wiggle(2, 30)',
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ dryRun: true, property: 'Position' });
    expect(outcome.value?.changes).toEqual([{ index: 1, from: '', to: 'wiggle(2, 30)' }]);
    expect(positionProperty(comp, 1)?.expression).toBe('');
  });

  it('sets the expression and enables it when dryRun is false', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedPositionComp(ae, 1, 'Main', [[0, 0]]);
    ae.project.activeItem = comp;

    const outcome = invoke(ctx, 'bulk.set_expression', {
      comp: 'Main',
      property: 'Position',
      expression: 'wiggle(2, 30)',
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ dryRun: false, applied: 1 });
    expect(positionProperty(comp, 1)?.expression).toBe('wiggle(2, 30)');
    expect(positionProperty(comp, 1)?.expressionEnabled).toBe(true);
  });

  it('clears and disables the expression when given an empty string', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedPositionComp(ae, 1, 'Main', [[0, 0]]);
    ae.project.activeItem = comp;
    invoke(ctx, 'bulk.set_expression', {
      comp: 'Main',
      property: 'Position',
      expression: 'wiggle(2, 30)',
      dryRun: false,
    });

    invoke(ctx, 'bulk.set_expression', {
      comp: 'Main',
      property: 'Position',
      expression: '',
      dryRun: false,
    });

    expect(positionProperty(comp, 1)?.expression).toBe('');
    expect(positionProperty(comp, 1)?.expressionEnabled).toBe(false);
  });

  it('skips layers that have no such property', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['Plain']);

    const outcome = invoke(ctx, 'bulk.set_expression', {
      comp: 'Main',
      property: 'Position',
      expression: 'time',
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.value?.changes).toEqual([]);
    expect(outcome.value?.skipped).toEqual([{ index: 1, reason: 'no property' }]);
  });

  it('requires a property name', async () => {
    const { ctx, ae } = await payloadContext();
    seedPositionComp(ae, 1, 'Main', [[0, 0]]);

    const outcome = invoke(ctx, 'bulk.set_expression', { comp: 'Main', expression: 'time' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('requires an expression', async () => {
    const { ctx, ae } = await payloadContext();
    seedPositionComp(ae, 1, 'Main', [[0, 0]]);

    const outcome = invoke(ctx, 'bulk.set_expression', { comp: 'Main', property: 'Position' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });
});

describe('bulk.apply_preset', () => {
  const preset = '/presets/blur.ffx';

  function seedPreset(ae: MockAE): void {
    ae.fs.set(preset, 'fake ffx');
  }

  it('previews the layer selection by default without applying the preset', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Layer 1', 'Layer 2']);
    seedPreset(ae);

    const outcome = invoke(ctx, 'bulk.apply_preset', { comp: 'Main', preset });

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ dryRun: true, preset });
    expect(outcome.value?.changes).toEqual([{ index: 1 }, { index: 2 }]);
    expect(presetsOf(comp, 1)).toEqual([]);
  });

  it('applies the preset to each layer when dryRun is false', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Layer 1', 'Layer 2']);
    seedPreset(ae);

    const outcome = invoke(ctx, 'bulk.apply_preset', { comp: 'Main', preset, dryRun: false });

    expect(outcome.value).toMatchObject({ dryRun: false, applied: 2 });
    expect(presetsOf(comp, 1)).toEqual([preset]);
    expect(presetsOf(comp, 2)).toEqual([preset]);
  });

  it('rejects a preset file that does not exist', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['Layer 1']);

    const outcome = invoke(ctx, 'bulk.apply_preset', { comp: 'Main', preset: '/nope.ffx' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('requires a preset path', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['Layer 1']);

    const outcome = invoke(ctx, 'bulk.apply_preset', { comp: 'Main' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });
});

function seedTextComp(ae: MockAE, id: number, name: string, texts: string[]): MockCompItem {
  const comp = new MockCompItem(id, name, 1920, 1080, 25, 10);
  ae.project.add(comp);
  ae.project.activeItem = comp;
  texts.forEach((text) => {
    comp.layers.addText(text);
  });
  return comp;
}

function textAt(comp: MockCompItem, index: number): string | null {
  const layer = comp.layer(index);
  const group = layer?.property('ADBE Text Properties');
  const prop = (group as MockPropertyGroup | null)?.property('ADBE Text Document');
  const value = (prop as MockProperty | null)?.value;
  if (value && typeof value === 'object' && 'text' in value) {
    return (value as { text: string }).text;
  }
  return null;
}

describe('bulk.replace_text', () => {
  it('previews the replacements by default and leaves the text untouched', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedTextComp(ae, 1, 'Main', ['Hello World', 'Hello Again']);

    const outcome = invoke(ctx, 'bulk.replace_text', {
      comp: 'Main',
      find: 'Hello',
      replace: 'Goodbye',
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ dryRun: true });
    expect(outcome.value?.changes).toEqual([
      { comp: 'Main', index: 1, from: 'Hello World', to: 'Goodbye World' },
      { comp: 'Main', index: 2, from: 'Hello Again', to: 'Goodbye Again' },
    ]);
    expect(typeof outcome.value?.fingerprint).toBe('string');
    expect(textAt(comp, 1)).toBe('Hello World');
    expect(textAt(comp, 2)).toBe('Hello Again');
  });

  it('replaces the text when dryRun is false', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedTextComp(ae, 1, 'Main', ['Hello World', 'Hello Again']);

    const outcome = invoke(ctx, 'bulk.replace_text', {
      comp: 'Main',
      find: 'Hello',
      replace: 'Goodbye',
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ dryRun: false, applied: 2 });
    expect(textAt(comp, 1)).toBe('Goodbye World');
    expect(textAt(comp, 2)).toBe('Goodbye Again');
  });

  it('replaces by regular expression with capture groups', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedTextComp(ae, 1, 'Main', ['foo_01', 'foo_02']);

    const outcome = invoke(ctx, 'bulk.replace_text', {
      comp: 'Main',
      find: 'foo_(\\d+)',
      replace: 'bar_$1',
      regex: true,
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ applied: 2 });
    expect(textAt(comp, 1)).toBe('bar_01');
    expect(textAt(comp, 2)).toBe('bar_02');
  });

  it('replaces across several comps', async () => {
    const { ctx, ae } = await payloadContext();
    const compA = seedTextComp(ae, 1, 'Comp A', ['text']);
    const compB = seedTextComp(ae, 2, 'Comp B', ['text']);

    const outcome = invoke(ctx, 'bulk.replace_text', {
      comps: ['Comp A', 'Comp B'],
      find: 'text',
      replace: 'copy',
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ applied: 2 });
    expect(textAt(compA, 1)).toBe('copy');
    expect(textAt(compB, 1)).toBe('copy');
    expect(outcome.value?.changes).toEqual([
      { comp: 'Comp A', index: 1, from: 'text', to: 'copy' },
      { comp: 'Comp B', index: 1, from: 'text', to: 'copy' },
    ]);
  });

  it('limits the change to the requested layers', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedTextComp(ae, 1, 'Main', ['text', 'text']);

    invoke(ctx, 'bulk.replace_text', {
      comp: 'Main',
      layers: [2],
      find: 'text',
      replace: 'copy',
      dryRun: false,
    });

    expect(textAt(comp, 1)).toBe('text');
    expect(textAt(comp, 2)).toBe('copy');
  });

  it('skips layers that are not text layers', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['Solid']);

    const outcome = invoke(ctx, 'bulk.replace_text', { comp: 'Main', find: 'a', replace: 'b' });

    expect(outcome.ok).toBe(true);
    expect(outcome.value?.changes).toEqual([]);
    expect(outcome.value?.skipped).toEqual([{ comp: 'Main', index: 1 }]);
  });

  it('requires a find string', async () => {
    const { ctx, ae } = await payloadContext();
    seedTextComp(ae, 1, 'Main', ['text']);

    const outcome = invoke(ctx, 'bulk.replace_text', { comp: 'Main', replace: 'b' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('rejects an invalid regular expression', async () => {
    const { ctx, ae } = await payloadContext();
    seedTextComp(ae, 1, 'Main', ['text']);

    const outcome = invoke(ctx, 'bulk.replace_text', {
      comp: 'Main',
      find: '(',
      replace: 'b',
      regex: true,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('reports a composition that does not exist', async () => {
    const { ctx } = await payloadContext();

    const outcome = invoke(ctx, 'bulk.replace_text', { comp: 'Nope', find: 'a', replace: 'b' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
    expect(outcome.issue?.message).toContain('Nope');
  });
});

function layerStartTime(comp: MockCompItem, index: number): number {
  return (comp.layer(index) as MockLayer | null)?.startTime ?? 0;
}

function seedKeyedComp(
  ae: MockAE,
  id: number,
  name: string,
  layerCount: number,
  times: number[],
): MockCompItem {
  const comp = new MockCompItem(id, name, 1920, 1080, 25, 10);
  ae.project.add(comp);
  ae.project.activeItem = comp;
  for (let l = 0; l < layerCount; l += 1) {
    const layer = new MockAVLayer('Layer', 'Layer');
    const transform = new MockPropertyGroup('Transform', 'ADBE Transform Group');
    const position = new MockProperty('Position', 'ADBE Position', [0, 0]);
    times.forEach((time) => position.key(time, [0, 0]));
    transform.add(position);
    layer.add(transform);
    comp.addLayer(layer);
  }
  return comp;
}

function positionKeys(comp: MockCompItem, index: number): number[] {
  const layer = comp.layer(index);
  const group = layer?.property('ADBE Transform Group');
  const prop = (group as MockPropertyGroup | null)?.property('ADBE Position') as MockProperty | null;
  if (!prop) {
    return [];
  }
  const out: number[] = [];
  for (let k = 1; k <= prop.numKeys; k += 1) {
    out.push(prop.keyTime(k));
  }
  return out;
}

describe('bulk.stagger', () => {
  it('previews a proportional layer offset by default', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['A', 'B', 'C']);

    const outcome = invoke(ctx, 'bulk.stagger', { comp: 'Main', offset: 1 });

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ dryRun: true, target: 'layers' });
    expect(outcome.value?.changes).toEqual([
      { comp: 'Main', index: 2, from: 0, to: 1 },
      { comp: 'Main', index: 3, from: 0, to: 2 },
    ]);
    expect(typeof outcome.value?.fingerprint).toBe('string');
    expect(layerStartTime(comp, 2)).toBe(0);
  });

  it('offsets layers proportionally when dryRun is false', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['A', 'B', 'C']);

    const outcome = invoke(ctx, 'bulk.stagger', { comp: 'Main', offset: 2, dryRun: false });

    expect(outcome.value).toMatchObject({ dryRun: false, applied: 2 });
    expect(layerStartTime(comp, 1)).toBe(0);
    expect(layerStartTime(comp, 2)).toBe(2);
    expect(layerStartTime(comp, 3)).toBe(4);
  });

  it('offsets every layer by the same amount in fixed mode', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['A', 'B', 'C']);

    const outcome = invoke(ctx, 'bulk.stagger', {
      comp: 'Main',
      offset: 0.5,
      mode: 'fixed',
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ applied: 3 });
    expect(layerStartTime(comp, 1)).toBe(0.5);
    expect(layerStartTime(comp, 2)).toBe(0.5);
    expect(layerStartTime(comp, 3)).toBe(0.5);
  });

  it('follows the order of the requested layers', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['A', 'B', 'C']);

    const outcome = invoke(ctx, 'bulk.stagger', {
      comp: 'Main',
      layers: [3, 1],
      offset: 1,
      dryRun: false,
    });

    expect(outcome.value?.changes).toEqual([{ comp: 'Main', index: 1, from: 0, to: 1 }]);
    expect(layerStartTime(comp, 1)).toBe(1);
    expect(layerStartTime(comp, 3)).toBe(0);
  });

  it('previews a proportional keyframe offset', async () => {
    const { ctx, ae } = await payloadContext();
    seedKeyedComp(ae, 1, 'Main', 2, [0, 1]);

    const outcome = invoke(ctx, 'bulk.stagger', {
      comp: 'Main',
      target: 'keyframes',
      property: 'Position',
      offset: 0.5,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ dryRun: true, target: 'keyframes' });
    expect(outcome.value?.changes).toEqual([
      { comp: 'Main', index: 2, from: [0, 1], to: [0.5, 1.5] },
    ]);
  });

  it('shifts the keyframes of each layer when dryRun is false', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedKeyedComp(ae, 1, 'Main', 2, [0, 1]);

    const outcome = invoke(ctx, 'bulk.stagger', {
      comp: 'Main',
      target: 'keyframes',
      property: 'Position',
      offset: 0.5,
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ dryRun: false, applied: 1 });
    expect(positionKeys(comp, 1)).toEqual([0, 1]);
    expect(positionKeys(comp, 2)).toEqual([0.5, 1.5]);
  });

  it('skips layers without the keyframed property', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['A']);

    const outcome = invoke(ctx, 'bulk.stagger', {
      comp: 'Main',
      target: 'keyframes',
      property: 'Position',
      offset: 1,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.value?.changes).toEqual([]);
    expect(outcome.value?.skipped).toEqual([{ comp: 'Main', index: 1, reason: 'no property' }]);
  });

  it('skips a property that has no keyframes', async () => {
    const { ctx, ae } = await payloadContext();
    seedPositionComp(ae, 1, 'Main', [[0, 0]]);

    const outcome = invoke(ctx, 'bulk.stagger', {
      comp: 'Main',
      target: 'keyframes',
      property: 'Position',
      offset: 1,
    });

    expect(outcome.value?.changes).toEqual([]);
    expect(outcome.value?.skipped).toEqual([{ comp: 'Main', index: 1, reason: 'no keyframes' }]);
  });

  it('requires a property when staggering keyframes', async () => {
    const { ctx, ae } = await payloadContext();
    seedKeyedComp(ae, 1, 'Main', 1, [0]);

    const outcome = invoke(ctx, 'bulk.stagger', { comp: 'Main', target: 'keyframes', offset: 1 });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('requires an offset', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['A']);

    const outcome = invoke(ctx, 'bulk.stagger', { comp: 'Main' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('reports a composition that does not exist', async () => {
    const { ctx } = await payloadContext();

    const outcome = invoke(ctx, 'bulk.stagger', { comp: 'Nope', offset: 1 });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
    expect(outcome.issue?.message).toContain('Nope');
  });
});
