import { describe, it, expect } from 'vitest';
import { defaultOperationRegistry, unknownOperationDetails, validateOperationArgs } from './operations.js';

// Every operation the bridge registers (`packages/bridge/src/handlers.js` plus
// `batch.run` in `job-runner.js`), minus the top-level MCP tools.
const BRIDGE_OPS = [
  'comp.snapshot',
  'comp.diff',
  'property.sample',
  'keyframe.times',
  'project.info',
  'project.export_json',
  'project.report_usage',
  'project.lint',
  'project.save',
  'project.open',
  'project.new',
  'project.import_json',
  'project.increment_save',
  'comp.create',
  'comp.duplicate',
  'comp.set_settings',
  'comp.precompose',
  'comp.layer_clip_frames',
  'comp.info',
  'layer.add_text',
  'layer.add_shape',
  'layer.add_camera',
  'layer.add_light',
  'layer.set_3d',
  'layer.add_solid',
  'layer.add_adjustment',
  'layer.add_null',
  'layer.add_footage',
  'layer.center',
  'layer.set_transform',
  'layer.rename',
  'layer.set_parent',
  'layer.delete',
  'layer.bounds',
  'property.get',
  'property.list',
  'property.set',
  'keyframe.add',
  'keyframe.remove',
  'keyframe.set_easing',
  'keyframe.ease_preset',
  'keyframe.copy',
  'keyframe.offset',
  'keyframe.reverse',
  'keyframe.scale_time',
  'anchor.move_preserving',
  'expression.set',
  'expression.clear',
  'expression.check_errors',
  'expression.snippet',
  'text.animate',
  'template.lower_third',
  'template.title_card',
  'template.transition',
  'template.logo_reveal',
  'look.apply',
  'versions.generate',
  'mogrt.export',
  'audio.to_keyframes',
  'animate',
  'localize.apply',
  'rig.null_controller',
  'effect.apply',
  'effect.list_on_layer',
  'effect.list_available',
  'effect.set_property',
  'effect.set_keyframe',
  'effect.remove',
  'preset.apply_ffx',
  'preset.list',
  'preset.search',
  'marker.add',
  'marker.add_bulk',
  'marker.list',
  'mask.add',
  'mask.set',
  'mask.read',
  'shape.add',
  'layer.set_blend_mode',
  'shape.set',
  'shape.read',
  'text.add',
  'text.set',
  'text.read',
  'audio.set_levels',
  'audio.info',
  'audio.peaks_to_markers',
  'render.frame',
  'render.queue_add',
  'render.queue_set_output',
  'render.status',
  'render.templates',
  'font.list',
  'command.find',
  'command.list',
  'command.execute',
  'project.import_file',
  'footage.replace',
  'footage.relink',
  'bulk.rename',
  'bulk.set_property',
  'bulk.apply_effect',
  'bulk.set_expression',
  'bulk.apply_preset',
  'bulk.replace_text',
  'bulk.stagger',
  'bulk.set_label',
  'bulk.remove_unused',
  'bulk.duplicate_comp',
  'bulk.organize_items',
  'bulk.resize_comp',
  'project.import_folder',
  'project.reduce',
  'project.consolidate_footage',
  'batch.run',
  'eval.run',
  'layer.move',
  'render.queue_remove',
];

describe('server operation registry', () => {
  it('registers every bridge operation', () => {
    const registry = defaultOperationRegistry();
    expect(registry.names().sort()).toEqual([...BRIDGE_OPS].sort());
  });

  it('gives each operation a category, description, flags and schema', () => {
    const registry = defaultOperationRegistry();
    for (const name of registry.names()) {
      const definition = registry.get(name);
      expect(definition).toBeDefined();
      // look.apply is an effect-category op (#217), not a 'look' category.
      // look.apply is an effect-category op (#217), not a 'look' category.
      // versions.generate is a bulk op (#239) that ae_plan can preview.
      // mogrt.export is a comp-category op (#241). animate is a keyframe-category op (#260).
      const expectedCategory =
        name === 'versions.generate' ? 'bulk' : name === 'mogrt.export' ? 'comp' : name === 'localize.apply' ? 'text' : name === 'animate' ? 'keyframe' : name.split('.')[0];
      expect(definition!.category).toBe(name === 'look.apply' ? 'effect' : expectedCategory);
      expect(definition!.description.length).toBeGreaterThan(0);
      expect(typeof definition!.readOnly).toBe('boolean');
      expect(typeof definition!.destructive).toBe('boolean');
      expect(definition!.schema).toBeTypeOf('object');
    }
  });

  it('flags the delete/remove and command.execute operations destructive', () => {
    const registry = defaultOperationRegistry();
    const destructive = ['layer.delete', 'keyframe.remove', 'effect.remove', 'command.execute'];
    for (const name of destructive) {
      expect(registry.get(name)!.destructive).toBe(true);
    }
  });

  // render.frame is read-only, so it must not take an output path (#178).
  it('rejects a file argument on render.frame', () => {
    const schema = defaultOperationRegistry().get('render.frame')!.schema;
    expect(validateOperationArgs(schema, { file: '/tmp/x.png' }).ok).toBe(false);
  });

  it('names every required argument that is a key of its schema', () => {
    const registry = defaultOperationRegistry();
    for (const name of registry.names()) {
      const definition = registry.get(name)!;
      expect(Array.isArray(definition.required)).toBe(true);
      for (const arg of definition.required ?? []) {
        expect(Object.keys(definition.schema), `${name} requires ${arg}`).toContain(arg);
      }
    }
  });

  it('lists the required arguments of layer.rename and keyframe.add', () => {
    const registry = defaultOperationRegistry();
    expect(registry.get('layer.rename')!.required).toEqual(['index', 'name']);
    expect(registry.get('keyframe.add')!.required).toEqual(['property', 'time', 'value']);
    expect(registry.get('render.frame')!.required).toEqual([]);
  });
});

describe('validateOperationArgs required arguments', () => {
  const schema = { index: { type: 'number' }, name: { type: 'string' } };

  it('rejects a missing required argument, naming it', () => {
    expect(validateOperationArgs(schema, { index: 1 }, ['index', 'name'])).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^missing required argument 'name'\. Accepted arguments: /),
      details: { arg: 'name', expected: 'required' },
    });
  });

  it('rejects a missing required argument when no args are given at all', () => {
    expect(validateOperationArgs(schema, undefined, ['index'])).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^missing required argument 'index'/),
      details: { arg: 'index', expected: 'required' },
    });
  });

  it('accepts the call when every required argument is present', () => {
    expect(validateOperationArgs(schema, { index: 1, name: 'Hero' }, ['index', 'name'])).toEqual({
      ok: true,
      args: { index: 1, name: 'Hero' },
    });
  });

  it('accepts falsy required values such as 0 and an empty string', () => {
    expect(validateOperationArgs(schema, { index: 0, name: '' }, ['index', 'name']).ok).toBe(true);
  });

  it('accepts layer by name or {id} in place of a required index', () => {
    expect(validateOperationArgs(schema, { layer: 'Hero', name: 'Hero2' }, ['index', 'name']).ok).toBe(true);
    expect(validateOperationArgs(schema, { layer: { id: 7 }, name: 'Hero2' }, ['index', 'name']).ok).toBe(true);
  });

  it('accepts layer by name or {id} in place of layerIndex', () => {
    const markerSchema = { comp: { type: 'string' }, layerIndex: { type: 'number' } };
    expect(validateOperationArgs(markerSchema, { comp: 'Main', layer: 'Hero' }).ok).toBe(true);
    expect(validateOperationArgs(markerSchema, { comp: 'Main', layer: { id: 7 } }).ok).toBe(true);
    expect(validateOperationArgs(markerSchema, { comp: 'Main', layerIndex: 2 }).ok).toBe(true);
  });

  it('rejects layer on an operation whose schema has no index', () => {
    expect(validateOperationArgs({ name: { type: 'string' } }, { layer: 'Hero' })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^unknown argument 'layer'/),
    });
  });

  it('keeps accepting calls without args when nothing is required', () => {
    expect(validateOperationArgs(schema, undefined)).toEqual({ ok: true, args: {} });
  });
});

describe('validateOperationArgs details (#237)', () => {
  const schema = {
    index: { type: 'number' },
    name: { type: 'string' },
    lightType: { type: 'string', enum: ['parallel', 'spot', 'point', 'ambient'] },
  };

  it('names the enum values allowed and the closest one for a misspelled enum value', () => {
    expect(validateOperationArgs(schema, { lightType: 'sopt' })).toEqual({
      ok: false,
      message: `argument 'lightType' must be one of ["parallel","spot","point","ambient"]`,
      details: {
        arg: 'lightType',
        expected: 'one of the allowed values',
        allowed: ['parallel', 'spot', 'point', 'ambient'],
        closest: ['spot'],
      },
    });
  });

  it('omits closest for an enum value nothing resembles', () => {
    const result = validateOperationArgs(schema, { lightType: 'zzzzzzzz' });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ details: { arg: 'lightType', allowed: expect.any(Array) } });
    expect((result as { details: object }).details).not.toHaveProperty('closest');
  });

  it('gives the argument and its expected type for a wrong type', () => {
    expect(validateOperationArgs(schema, { index: 'one' })).toEqual({
      ok: false,
      message: "argument 'index' must be a number",
      details: { arg: 'index', expected: 'number' },
    });
  });

  it('suggests the closest argument name for an unknown argument', () => {
    expect(validateOperationArgs(schema, { nmae: 'Hero' })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^unknown argument 'nmae' \(did you mean 'name'\?\)/),
      details: { arg: 'nmae', closest: ['name'] },
    });
  });

  it('omits closest for an unknown argument with no close name', () => {
    const result = validateOperationArgs(schema, { qqqqqqqqqqqq: 1 });
    expect(result).toMatchObject({ ok: false, details: { arg: 'qqqqqqqqqqqq' } });
    expect(result.ok ? {} : result.details).not.toHaveProperty('closest');
  });

  // A Claude Desktop session sent `name` (a property path) to property.sample four times,
  // each time told only "missing required argument 'property'".
  it('names the wrong argument, the missing one, and every accepted argument', () => {
    const sample = { comp: { type: 'string' }, index: { type: 'number' }, property: { type: 'string' }, times: { type: 'array' } };
    const result = validateOperationArgs(sample, { comp: 'Logo', index: 1, name: 'Contents/Group 9/Transform/Scale', times: [0] }, ['index', 'property', 'times']);
    expect(result).toMatchObject({
      ok: false,
      message:
        "unknown argument 'name' (did you mean 'property'?); missing required argument 'property'. Accepted arguments: comp, index, property, times",
      details: { arg: 'name', accepted: ['comp', 'index', 'property', 'times'] },
    });
  });
});

describe('unknownOperationDetails', () => {
  it('suggests the closest operation name', () => {
    expect(unknownOperationDetails(['layer.rename', 'comp.create'], 'layer.renam')).toEqual({
      arg: 'op',
      closest: ['layer.rename'],
    });
  });

  it('omits closest when no operation name is close', () => {
    expect(unknownOperationDetails(['layer.rename'], 'zzzzzzzzzzzzzzzz')).toEqual({ arg: 'op' });
  });
});
