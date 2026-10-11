import { describe, it, expect } from 'vitest';
import { defaultOperationRegistry } from './operations.js';

// Every operation the bridge registers (`packages/bridge/src/handlers.js` plus
// `batch.run` in `job-runner.js`), minus the top-level MCP tools.
const BRIDGE_OPS = [
  'project.info',
  'project.export_json',
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
  'expression.set',
  'expression.clear',
  'expression.check_errors',
  'effect.apply',
  'effect.list_on_layer',
  'effect.list_available',
  'effect.set_property',
  'effect.set_keyframe',
  'effect.remove',
  'effect.apply_template',
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
  'font.list',
  'command.find',
  'command.list',
  'command.execute',
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
});