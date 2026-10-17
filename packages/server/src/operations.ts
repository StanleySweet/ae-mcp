import type { OperationCategory, OperationDefinition } from '@ae-mcp/protocol';
import { registerEvalOperations } from './operations-eval.js';
import { registerHousekeepingOperations } from './operations-housekeeping.js';
import { registerLayerOperations } from './operations-layers.js';
import { registerProjectOperations } from './operations-project.js';
import { registerRelinkOperations } from './operations-relink.js';

import { registerTemplateOperations } from './operations-templates.js';
import { registerVerifyOperations } from './operations-verify.js';

export class OperationRegistry {
  private readonly byName = new Map<string, OperationDefinition>();

  register(definition: OperationDefinition): void {
    // Every listed operation carries a `required` list, empty when it has none.
    this.byName.set(definition.name, { ...definition, required: definition.required ?? [] });
  }

  get(name: string): OperationDefinition | undefined {
    return this.byName.get(name);
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  list(category?: string): OperationDefinition[] {
    const all = [...this.byName.values()];
    const filtered = category ? all.filter((op) => op.category === category) : all;
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }
}

function operation(
  name: string,
  category: OperationCategory,
  description: string,
  options: {
    readOnly?: boolean;
    destructive?: boolean;
    schema?: Record<string, unknown>;
    required?: string[];
  } = {},
): OperationDefinition {
  return {
    name,
    category,
    description,
    readOnly: options.readOnly ?? false,
    destructive: options.destructive ?? false,
    schema: options.schema ?? {},
    required: options.required ?? [],
  };
}

const comp = { type: 'string' };
const layerIndex = { type: 'number' };
const propertyName = { type: 'string' };
const effectName = { type: 'string' };

// One entry per operation the bridge implements (`packages/bridge/src/handlers.js`
// plus `batch.run` in `job-runner.js`), so `ae_do` can dispatch it and `ae_catalog`
// lists it. Schemas mirror the arguments each handler reads. Destructive flags
// follow docs/BACKLOG.md §E13: every delete/remove and `command.execute`.
export function defaultOperationRegistry(): OperationRegistry {
  const registry: OperationRegistry = new OperationRegistry();
  const register = (definition: OperationDefinition): void => {
    registry.register(definition);
  };

  // Project.
  register(operation('project.info', 'project', 'Report the open project summary.', { readOnly: true }));
  register(operation('project.export_json', 'project', 'Snapshot the whole project as JSON.', {
    readOnly: true,
  }));
  register(operation('project.report_usage', 'project', 'Report unused items and footage with a missing source file.', {
    readOnly: true,
  }));
  register(
    operation('project.import_file', 'project', 'Import one or more files into the project, optionally into a folder.', {
      schema: {
        path: { type: 'string' },
        paths: { type: 'array', items: { type: 'string' } },
        folder: { type: 'string' },
      },
    }),
  );
  register(
    operation('footage.replace', 'footage', 'Replace the source file of a footage item.', {
      required: ['item', 'path'],
      schema: {
        item: { oneOf: [{ type: 'number' }, { type: 'string' }] },
        path: { type: 'string' },
      },
    }),
  );
  register(operation('project.save', 'project', 'Save the open project, or Save As when path is given (never prompts). Save As refuses an existing file unless overwrite: true.', {
    schema: { path: { type: 'string' }, overwrite: { type: 'boolean' } },
  }));
  register(operation('project.open', 'project', 'Open a project file, replacing the open project. Refuses unless force: true when the open project has unsaved changes or that cannot be told.', {
      required: ['path'],
    destructive: true,
    schema: { path: { type: 'string' }, force: { type: 'boolean' } },
  }));
  register(operation('project.import_json', 'project', 'Recreate comps and solid/text/null/shape layers (with transforms) from an aemcp-project/v1 snapshot (project.export_json); other layers are reported as skipped.', {
      required: ['snapshot'],
    schema: { snapshot: { type: 'object' } },
  }));
  register(operation('project.increment_save', 'project', 'File > Increment and Save the project.'));

  // Comp (comp.info is the server tool ae_comp_info).
  register(
    operation('comp.create', 'comp', 'Create a composition.', {
      schema: {
        name: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        pixelAspect: { type: 'number' },
        duration: { type: 'number' },
        fps: { type: 'number' },
      },
    }),
  );
  register(
    operation('comp.duplicate', 'comp', 'Duplicate a composition.', {
      schema: { comp, name: comp, newName: comp },
    }),
  );
  register(
    operation('comp.set_settings', 'comp', 'Change a composition width, height, pixel aspect, duration, frame rate, background colour or name.', {
      schema: {
        comp,
        name: comp,
        width: { type: 'number' },
        height: { type: 'number' },
        pixelAspect: { type: 'number' },
        duration: { type: 'number' },
        fps: { type: 'number' },
        frameRate: { type: 'number' },
        bgColor: { type: 'array' },
        newName: comp,
      },
    }),
  );
  register(
    operation('comp.precompose', 'comp', 'Precompose layers of a composition into a new comp.', {
      schema: {
        comp,
        name: comp,
        newName: comp,
        layers: { type: 'array' },
        moveAllAttributes: { type: 'boolean' },
      },
    }),
  );
  register(
    operation('comp.layer_clip_frames', 'comp', 'Set layer in-point and out-point from frame numbers.', {
      required: ['from', 'to'],
      schema: {
        comp,
        name: comp,
        from: { type: 'integer' },
        to: { type: 'integer' },
        layers: { type: 'array' },
      },
    }),
  );
  register(
    operation('comp.info', 'comp', 'Report composition information.', {
      readOnly: true,
      schema: { comp, name: comp },
    }),
  );

  // Layer.
  register(operation('layer.add_text', 'layer', 'Add a text layer.', { schema: { comp, text: comp, name: { type: 'string' } } }));
  register(operation('layer.add_shape', 'layer', 'Add a shape layer.', { schema: { comp, name: { type: 'string' } } }));
  const centerPoint = { type: 'array', description: '[x, y]; defaults to the comp centre.' };
  register(operation('layer.add_camera', 'layer', 'Add a camera layer.', {
    schema: { comp, name: { type: 'string' }, centerPoint },
  }));
  register(operation('layer.add_light', 'layer', 'Add a light layer.', {
    schema: {
      comp,
      name: { type: 'string' },
      centerPoint,
      lightType: { type: 'string', enum: ['parallel', 'spot', 'point', 'ambient'] },
    },
  }));
  register(operation('layer.set_3d', 'layer', 'Turn the 3D switch on or off for a layer (not camera/light).', {
      required: ['index'],
    schema: { comp, index: layerIndex, enabled: { type: 'boolean' } },
  }));
  register(operation('layer.add_solid', 'layer', 'Add a solid layer.', {
    schema: { comp, color: { type: 'array' }, name: { type: 'string' } },
  }));
  register(operation('layer.add_adjustment', 'layer', 'Add an adjustment layer.', { schema: { comp, name: { type: 'string' } } }));
  register(operation('layer.add_null', 'layer', 'Add a null layer.', { schema: { comp, name: { type: 'string' } } }));
  register(operation('layer.add_footage', 'layer', 'Add a footage layer.', { required: ['name'], schema: { comp, name: comp } }));
  register(operation('layer.center', 'layer', 'Center selected layers.', { schema: { comp } }));
  register(operation('layer.set_transform', 'layer', "Set a layer's anchor point, position, scale, rotation and/or opacity.", {
      required: ['index'],
    schema: {
      comp,
      index: layerIndex,
      anchorPoint: { type: 'array' },
      position: { type: 'array' },
      scale: { type: 'array' },
      rotation: { type: 'number' },
      opacity: { type: 'number' },
    },
  }));
  register(operation('layer.set_parent', 'layer', 'Parent a layer to another layer.', {
    schema: { comp, index: layerIndex, parent: layerIndex },
  }));
  register(operation('layer.delete', 'layer', 'Delete a layer.', {
    destructive: true,
    schema: { comp, index: layerIndex },
    // Required: without it the handler would delete layer 1 (#220).
    required: ['index'],
  }));
  register(operation('layer.bounds', 'layer', 'Report a layer bounds box in composition space.', {
    readOnly: true,
    schema: { comp, index: layerIndex, time: { type: 'number' } },
  }));

  // Property.
  register(operation('property.get', 'property', 'Read a property value from a layer.', {
      required: ['name'],
    readOnly: true,
    schema: { comp, index: layerIndex, name: propertyName },
  }));
  register(operation('property.list', 'property', "List each layer's properties, expanding groups by depth levels (default 1); pass index for one layer.", {
    readOnly: true,
    schema: { comp, index: layerIndex, depth: { type: 'number' } },
  }));
  register(operation('property.set', 'property', 'Set a property value on a layer.', {
      required: ['name', 'value'],
    schema: { comp, index: layerIndex, name: propertyName, value: {} },
  }));

  // Keyframe.
  register(operation('keyframe.add', 'keyframe', 'Add a keyframe on a property.', {
      required: ['property', 'time', 'value'],
    schema: { comp, index: layerIndex, time: { type: 'number' }, value: {}, property: propertyName },
  }));
  register(operation('keyframe.remove', 'keyframe', 'Remove a keyframe on a property.', {
      required: ['property', 'time'],
    destructive: true,
    schema: { comp, index: layerIndex, time: { type: 'number' }, property: propertyName },
  }));
  register(
    operation('keyframe.set_easing', 'keyframe', 'Set easing on a keyframe.', {
      required: ['property', 'time', 'easing'],
      schema: {
        comp,
        index: layerIndex,
        time: { type: 'number' },
        easing: { type: 'string', enum: ['linear', 'ease', 'easeIn', 'easeOut', 'hold'] },
        property: propertyName,
      },
    }),
  );
  register(
    operation('keyframe.ease_preset', 'keyframe', 'Apply an easing preset to the keyframes selected on a property.', {
      required: ['property', 'preset'],
      schema: {
        comp,
        index: layerIndex,
        property: propertyName,
        preset: { type: 'string', enum: ['ease_in', 'ease_out', 'overshoot'] },
      },
    }),
  );
  const keyTarget = {
    type: 'object',
    properties: { index: layerIndex, property: propertyName },
    required: ['index', 'property'],
  };
  register(
    operation('keyframe.copy', 'keyframe', 'Copy every keyframe (time, value, interpolation, temporal ease) onto another property.', {
      required: ['from', 'to'],
      schema: { comp, from: keyTarget, to: keyTarget, offset: { type: 'number' } },
    }),
  );
  register(
    operation('keyframe.offset', 'keyframe', 'Shift every keyframe of a property by a number of seconds, keeping easing.', {
      required: ['property', 'seconds'],
      schema: { comp, index: layerIndex, property: propertyName, seconds: { type: 'number' } },
    }),
  );
  register(
    operation('keyframe.reverse', 'keyframe', 'Mirror the keyframe times of a property within its first-to-last span.', {
      required: ['property'],
      schema: { comp, index: layerIndex, property: propertyName },
    }),
  );
  register(
    operation('keyframe.scale_time', 'keyframe', 'Scale keyframe times around the first key by a factor greater than 0.', {
      required: ['property', 'factor'],
      schema: { comp, index: layerIndex, property: propertyName, factor: { type: 'number' } },
    }),
  );
  register(
    operation('anchor.move_preserving', 'anchor', 'Move the anchor point while keeping the layer visually in place.', {
      schema: {
        comp,
        index: layerIndex,
        anchor: {},
      },
    }),
  );

  // Expression.
  register(operation('expression.set', 'expression', 'Set an expression on a layer property.', {
      required: ['property', 'value'],
    schema: { comp, index: layerIndex, property: propertyName, value: {} },
  }));
  register(operation('expression.clear', 'expression', 'Clear the expression on a layer property.', {
      required: ['property'],
    schema: { comp, index: layerIndex, property: propertyName },
  }));
  register(operation('expression.check_errors', 'expression', 'Check a layer property expression for errors.', {
      required: ['property'],
    readOnly: true,
    schema: { comp, index: layerIndex, property: propertyName },
  }));
  register(
    operation('expression.snippet', 'expression', 'Apply a named expression snippet to a property (20 snippets): wiggle, loop, delay, overshoot, loop_pingpong, inertia, inertia_strong (longer carry), bounce (amplitude 0.1, frequency 2, decay 5), bounce_soft (0.05, 1.5, 4), bounce_hard (0.25, 3, 6), time_counter (Source Text, rate 1/s), countdown (Source Text, from seconds, default 10), count_up (Source Text, counts 0 to `to` (default 100) over `seconds` (default 2)), wiggle_smooth (frequency 2, amplitude 10, octaves 1), loop_cycle, loop_offset, spring (damped oscillation after the last key: frequency 2, decay 5), clock (Source Text, elapsed time as MM:SS), random_flicker (Opacity-style flicker, amount 0-1 default 0.5, rate 12/s), follow (Position follows the layer named `target` after `delay` seconds, default 0.2).', {
      required: ['snippet', 'property'],
      schema: {
        comp,
        index: layerIndex,
        property: propertyName,
        snippet: {
          type: 'string',
          enum: ['wiggle', 'loop', 'delay', 'overshoot', 'loop_pingpong', 'inertia', 'inertia_strong', 'bounce', 'bounce_soft', 'bounce_hard', 'time_counter', 'countdown', 'count_up', 'wiggle_smooth', 'loop_cycle', 'loop_offset', 'spring', 'clock', 'random_flicker', 'follow'],
        },
        amplitude: { type: 'number' },
        frequency: { type: 'number' },
        octaves: { type: 'number' },
        decay: { type: 'number' },
        rate: { type: 'number' },
        from: { type: 'number' },
        to: { type: 'number' },
        seconds: { type: 'number' },
        amount: { type: 'number' },
        delay: { type: 'number' },
        target: { type: 'string' },
      },
    }),
  );

  // Rig.
  register(
    operation('rig.null_controller', 'rig', 'Create a controller null with slider controls and parent layers to it.', {
      schema: {
        comp,
        name: { type: 'string' },
        sliders: { type: 'array' },
        layers: { type: 'array' },
      },
    }),
  );

  // Effect (targets layer 1 unless the handler reads an index).
  register(operation('effect.apply', 'effect', 'Add an effect to a layer (display name or match name).', {
      required: ['effect'],
    schema: { comp, index: layerIndex, effect: effectName },
  }));
  register(operation('effect.list_on_layer', 'effect', 'List the effects on a layer.', {
    readOnly: true,
    schema: { comp, index: layerIndex },
  }));
  register(operation('effect.list_available', 'effect', 'List the effects available in the application.', {
    readOnly: true,
  }));
  register(operation('effect.set_property', 'effect', 'Set a property of an effect on a layer.', {
      required: ['effect', 'property', 'value'],
    schema: { comp, index: layerIndex, effect: effectName, property: propertyName, value: {} },
  }));
  register(operation('effect.set_keyframe', 'effect', 'Set a keyframe on a property of an effect on a layer.', {
      required: ['effect', 'property', 'time', 'value'],
    schema: {
      comp,
      index: layerIndex,
      effect: effectName,
      property: propertyName,
      time: { type: 'number' },
      value: {},
    },
  }));
  register(operation('effect.remove', 'effect', 'Remove an effect from a layer.', {
      required: ['effect'],
    destructive: true,
    schema: { comp, index: layerIndex, effect: effectName },
  }));

  // Preset.
  register(operation('preset.apply_ffx', 'preset', 'Apply an .ffx preset to a layer.', {
      required: ['path'],
    schema: { comp, index: layerIndex, path: comp },
  }));
  register(operation('preset.list', 'preset', 'List installed presets.', {
    readOnly: true,
    schema: { category: comp },
  }));
  register(operation('preset.search', 'preset', 'Search installed presets.', {
    readOnly: true,
    schema: { query: comp },
  }));

  // Marker.
  register(
    operation('marker.add', 'marker', 'Add a marker to a comp or layer.', {
      schema: {
        comp,
        layerIndex: { type: 'number' },
        time: { type: 'number' },
        comment: comp,
        duration: { type: 'number' },
      },
    }),
  );
  register(operation('marker.add_bulk', 'marker', 'Add several markers to a comp or layer.', {
      required: ['markers'],
    schema: { comp, layerIndex: { type: 'number' }, markers: { type: 'array' } },
  }));
  register(operation('marker.list', 'marker', 'List markers on a comp or layer.', {
    readOnly: true,
    schema: { comp, layerIndex: { type: 'number' } },
  }));

  // Mask.
  register(
    operation('mask.add', 'mask', 'Add a mask to a layer.', {
      schema: {
        comp,
        layerIndex,
        vertices: { type: 'array' },
        inTangents: { type: 'array' },
        outTangents: { type: 'array' },
        closed: { type: 'boolean' },
      },
    }),
  );
  register(
    operation('mask.set', 'mask', 'Set a mask shape on a layer.', {
      schema: {
        comp,
        layerIndex,
        maskIndex: layerIndex,
        vertices: { type: 'array' },
        inTangents: { type: 'array' },
        outTangents: { type: 'array' },
        closed: { type: 'boolean' },
      },
    }),
  );
  register(operation('mask.read', 'mask', 'Read a mask shape on a layer.', {
    readOnly: true,
    schema: { comp, layerIndex, maskIndex: layerIndex },
  }));

  // Shape.
  register(
    operation('shape.add', 'shape', 'Add a shape (path, rect or ellipse) to a shape layer; name labels the shape, layerName names a layer created when layerIndex is omitted. A new group is added below existing groups (drawn behind them) unless front: true.', {
      schema: {
        comp,
        layerIndex,
        type: { type: 'string', enum: ['path', 'rect', 'ellipse'] },
        name: { type: 'string' },
        layerName: { type: 'string' },
        size: { type: 'array' },
        position: { type: 'array' },
        vertices: { type: 'array' },
        inTangents: { type: 'array' },
        outTangents: { type: 'array' },
        closed: { type: 'boolean' },
        fillColor: { type: 'array' },
        fillOpacity: { type: 'number', description: '0-100' },
        strokeColor: { type: 'array' },
        strokeOpacity: { type: 'number', description: '0-100' },
        strokeWidth: { type: 'number' },
        groupPosition: { type: 'array' },
        groupScale: { type: 'array' },
        groupRotation: { type: 'number' },
        groupOpacity: { type: 'number', description: '0-100' },
        front: { type: 'boolean' },
      },
    }),
  );
  register(
    operation('shape.set', 'shape', 'Edit one group (1-based, default 1) of a shape layer: its first path (vertices, inTangents, outTangents, closed), rect/ellipse position, fill/stroke opacity, group transform, or front: true to move the group to the top.', {
      schema: {
        comp,
        layerIndex,
        group: { type: 'number', description: '1-based group index, default 1' },
        vertices: { type: 'array' },
        inTangents: { type: 'array' },
        outTangents: { type: 'array' },
        closed: { type: 'boolean' },
        position: { type: 'array' },
        fillOpacity: { type: 'number', description: '0-100' },
        strokeOpacity: { type: 'number', description: '0-100' },
        groupPosition: { type: 'array' },
        groupScale: { type: 'array' },
        groupRotation: { type: 'number' },
        groupOpacity: { type: 'number', description: '0-100' },
        front: { type: 'boolean' },
      },
    }),
  );
  register(operation('shape.read', 'shape', 'Read shape layer contents: each group with its name, items (path, rect, ellipse, fill, stroke) and group transform.', {
    readOnly: true,
    schema: { comp, layerIndex },
  }));

  // Text.
  register(operation('text.animate', 'text', 'Animate a layer over duration seconds (default 1) from its in point. Expression presets: typewriter (text layer, Source Text), fade_in (Opacity), slide_up (Position), scale_in (Scale 80 to 100), wave (Position bobs and settles). blur_in is keyframed instead: Gaussian Blur blurriness 30 to 0 on the effect it adds.', {
      required: ['preset'],
    schema: {
      comp,
      index: layerIndex,
      preset: { type: 'string', enum: ['typewriter', 'fade_in', 'slide_up', 'scale_in', 'blur_in', 'wave'] },
      duration: { type: 'number' },
    },
  }));
  register(operation('template.lower_third', 'template', 'Build a lower third (bar, title, optional subtitle) sliding in with eased Position keyframes; returns the created layer indices. style: classic (default), modern (wide blue bar), minimal (thin rule, no bar fill), news (full-width red bar). duration is the on-screen time in seconds (default 4).', {
      required: ['title'],
    schema: {
      comp,
      title: { type: 'string' },
      subtitle: { type: 'string' },
      duration: { type: 'number' },
      style: { type: 'string', enum: ['classic', 'modern', 'minimal', 'news'] },
    },
  }));
  register(operation('text.add', 'text', 'Add a text layer with optional styling.', {
      required: ['text'],
    schema: {
      comp,
      text: comp,
      fontSize: { type: 'number' },
      fillColor: { type: 'array' },
      font: { type: 'string' },
      justification: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
      tracking: { type: 'number' },
      leading: { type: 'number' },
    },
  }));
  register(
    operation('text.set', 'text', 'Set text and styling on an existing text layer.', {
      schema: {
        comp,
        layerIndex,
        text: comp,
        fontSize: { type: 'number' },
        fillColor: { type: 'array' },
        font: { type: 'string' },
        justification: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
        tracking: { type: 'number' },
        leading: { type: 'number' },
      },
    }),
  );
  register(operation('text.read', 'text', 'Read text and styling from a text layer.', {
    readOnly: true,
    schema: { comp, layerIndex },
  }));

  // Audio.
  register(operation('audio.set_levels', 'audio', 'Set audio levels on a layer.', {
      required: ['levels'],
    schema: { comp, layerIndex, levels: { type: 'array' } },
  }));
  register(operation('audio.info', 'audio', 'Report audio state on a layer.', {
    readOnly: true,
    schema: { comp, layerIndex },
  }));
  register(operation('audio.peaks_to_markers', 'audio', 'Write peak times as layer markers.', {
      required: ['peaks'],
    schema: { comp, layerIndex, peaks: { type: 'array' } },
  }));

  // Render.
  register(
    operation('render.frame', 'render', 'Save a single frame of a composition as a PNG.', {
      readOnly: true,
      schema: { comp, time: { type: 'number' } },
    }),
  );
  register(
    operation('render.queue_add', 'render', 'Add a composition to the render queue.', {
      schema: {
        comp,
        name: comp,
        timeSpanStart: { type: 'number' },
        timeSpanDuration: { type: 'number' },
      },
    }),
  );
  register(
    operation('render.queue_set_output', 'render', 'Set a render queue item output file and/or template.', {
      schema: { item: layerIndex, file: comp, template: comp },
    }),
  );
  register(operation('render.status', 'render', 'Report the render queue and item statuses.', {
    readOnly: true,
  }));

  // Font and command.
  register(operation('font.list', 'font', 'List installed fonts.', { readOnly: true }));
  register(operation('command.find', 'command', 'Find a menu command ID by name.', {
      required: ['name'],
    readOnly: true,
    schema: { name: comp },
  }));
  register(operation('command.list', 'command', 'List known menu command IDs.', { readOnly: true }));
  register(operation('command.execute', 'command', 'Execute a menu command.', {
    destructive: true,
    schema: { id: { type: 'number' }, name: comp },
  }));

  // Bulk (previewed edits; every bulk op honours `dryRun`, defaulting to true).
  register(
    operation('bulk.rename', 'bulk', 'Rename layers of a composition by pattern, regex or numbering.', {
      schema: {
        comp,
        layers: { type: 'array' },
        match: { type: 'string' },
        replace: { type: 'string' },
        regex: { type: 'boolean' },
        flags: { type: 'string' },
        prefix: { type: 'string' },
        suffix: { type: 'string' },
        numbering: { type: 'object' },
        dryRun: { type: 'boolean' },
      },
    }),
  );
  register(
    operation(
      'bulk.set_property',
      'bulk',
      'Set a property to the same value on many layers, optionally across several comps.',
      {
      required: ['property', 'value'],
        schema: {
          comp,
          comps: { type: 'array' },
          layers: { type: 'array' },
          property: { type: 'string' },
          value: {},
          dryRun: { type: 'boolean' },
        },
      },
    ),
  );
  register(
    operation('bulk.apply_effect', 'bulk', 'Add an effect to every selected layer.', {
      required: ['effect'],
      schema: {
        comp,
        layers: { type: 'array' },
        effect: { type: 'string' },
        dryRun: { type: 'boolean' },
      },
    }),
  );
  register(
    operation('bulk.set_expression', 'bulk', 'Set an expression on a property of every selected layer.', {
      required: ['property', 'expression'],
      schema: {
        comp,
        layers: { type: 'array' },
        property: { type: 'string' },
        expression: { type: 'string' },
        dryRun: { type: 'boolean' },
      },
    }),
  );
  register(
    operation('bulk.apply_preset', 'bulk', 'Apply a .ffx preset to every selected layer.', {
      required: ['preset'],
      schema: {
        comp,
        layers: { type: 'array' },
        preset: { type: 'string' },
        dryRun: { type: 'boolean' },
      },
    }),
  );
  register(
    operation('bulk.replace_text', 'bulk', 'Find and replace text on the text layers of one or more comps.', {
      required: ['find'],
      schema: {
        comp,
        comps: { type: 'array' },
        layers: { type: 'array' },
        find: { type: 'string' },
        replace: { type: 'string' },
        regex: { type: 'boolean' },
        flags: { type: 'string' },
        dryRun: { type: 'boolean' },
      },
    }),
  );
  register(
    operation('bulk.stagger', 'bulk', 'Offset layer start times or keyframe times by a fixed or proportional step.', {
      required: ['offset'],
      schema: {
        comp,
        layers: { type: 'array' },
        target: { type: 'string' },
        mode: { type: 'string' },
        offset: { type: 'number' },
        property: { type: 'string' },
        dryRun: { type: 'boolean' },
      },
    }),
  );
  register(
    operation('bulk.set_label', 'bulk', 'Set the label colour (0-16) on every selected layer.', {
      required: ['label'],
      schema: {
        comp,
        comps: { type: 'array' },
        layers: { type: 'array' },
        label: { type: 'number' },
        dryRun: { type: 'boolean' },
      },
    }),
  );
  register(
    operation('bulk.remove_unused', 'bulk', 'Remove every item that no composition uses.', {
      destructive: true,
      schema: {
        dryRun: { type: 'boolean' },
      },
    }),
  );
  register(
    operation('bulk.duplicate_comp', 'bulk', 'Duplicate a composition with a new name and optional new size.', {
      required: ['name'],
      schema: {
        comp,
        name: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        dryRun: { type: 'boolean' },
      },
    }),
  );
  register(
    operation('bulk.organize_items', 'bulk', 'Move items into project folders, creating missing folders.', {
      required: ['folders'],
      schema: {
        folders: { type: 'array' },
        dryRun: { type: 'boolean' },
      },
    }),
  );
  register(
    operation('bulk.resize_comp', 'bulk', 'Batch resize a composition into several named formats.', {
      required: ['formats'],
      schema: {
        comp,
        formats: { type: 'array' },
        dryRun: { type: 'boolean' },
      },
    }),
  );

  // Batch (container; the E13 guard checks its sub-operations).
  register(
    operation('batch.run', 'batch', 'Run many operations as one undo group. If a step fails after a changing step succeeded, the whole batch is rolled back (Edit > Undo) unless atomic is false.', {
      required: ['ops'],
      schema: { ops: { type: 'array', items: { type: 'object' } }, atomic: { type: 'boolean' } },
    }),
  );

  registerLayerOperations(register);
  registerHousekeepingOperations(register);
  registerRelinkOperations(register);
  registerVerifyOperations(register);
  registerTemplateOperations(register);
  registerEvalOperations(register);
  registerProjectOperations(register);

  return registry;
}

type PropertySchema = { type?: unknown; enum?: unknown };

const typeChecks: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => typeof value === 'number' && Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  array: (value) => Array.isArray(value),
  object: (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  null: (value) => value === null,
};

/**
 * Validates operation arguments against the operation's JSON-Schema-shaped property map,
 * and checks that every name in `required` is present.
 */
export function validateOperationArgs(
  schema: Record<string, unknown>,
  args: unknown,
  required: readonly string[] = [],
): { ok: true; args: Record<string, unknown> } | { ok: false; message: string } {
  if (args !== undefined && args !== null && (typeof args !== 'object' || Array.isArray(args))) {
    return { ok: false, message: 'arguments must be an object' };
  }
  const values = (args ?? {}) as Record<string, unknown>;
  for (const name of required) {
    if (values[name] === undefined) {
      return { ok: false, message: `missing required argument '${name}'` };
    }
  }
  for (const [key, value] of Object.entries(values)) {
    const property = schema[key] as PropertySchema | undefined;
    if (property === undefined) {
      return { ok: false, message: `unknown argument '${key}'` };
    }
    if (Array.isArray(property.enum) && !property.enum.includes(value)) {
      return {
        ok: false,
        message: `argument '${key}' must be one of ${JSON.stringify(property.enum)}`,
      };
    }
    const check = typeof property.type === 'string' ? typeChecks[property.type] : undefined;
    if (check && !check(value)) {
      return { ok: false, message: `argument '${key}' must be a ${property.type}` };
    }
  }
  return { ok: true, args: values };
}

function levenshtein(a: string, b: string): number {
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[cols - 1]!;
}

/** Names closest to a query by edit distance, nearest first. */
export function closestNames(names: string[], query: string, limit = 3): string[] {
  return names
    .map((name) => ({ name, distance: levenshtein(name, query) }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((entry) => entry.name);
}
