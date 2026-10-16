import { describe, it, expect } from 'vitest';
import { defaultOperationRegistry, validateOperationArgs } from './operations.js';

// Every operation the bridge registers (`packages/bridge/src/handlers.js` plus
// `batch.run` in `job-runner.js`), minus the top-level MCP tools.
const BRIDGE_OPS = [
  'project.info',
  'project.export_json',
  'project.report_usage',
  'project.undo',
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
  'font.list',
  'command.find',
  'command.list',
  'command.execute',
  'project.import_file',
  'footage.replace',
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
  'batch.run',
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
      expect(definition!.category).toBe(name.split('.')[0]);
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
});
