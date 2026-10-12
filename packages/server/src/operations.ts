import type { OperationCategory, OperationDefinition } from '@ae-mcp/protocol';

export class OperationRegistry {
  private readonly byName = new Map<string, OperationDefinition>();

  register(definition: OperationDefinition): void {
    this.byName.set(definition.name, definition);
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
  options: { readOnly?: boolean; destructive?: boolean; schema?: Record<string, unknown> } = {},
): OperationDefinition {
  return {
    name,
    category,
    description,
    readOnly: options.readOnly ?? false,
    destructive: options.destructive ?? false,
    schema: options.schema ?? {},
  };
}

const comp = { type: 'string' };
const layerIndex = { type: 'number' };
const propertyName = { type: 'string' };

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
  register(operation('project.undo', 'project', 'Undo the last change.'));
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
  register(operation('layer.add_text', 'layer', 'Add a text layer.', { schema: { comp, text: comp } }));
  register(operation('layer.add_shape', 'layer', 'Add a shape layer.', { schema: { comp } }));
  register(operation('layer.add_solid', 'layer', 'Add a solid layer.', {
    schema: { comp, color: { type: 'array' } },
  }));
  register(operation('layer.add_adjustment', 'layer', 'Add an adjustment layer.', { schema: { comp } }));
  register(operation('layer.add_null', 'layer', 'Add a null layer.', { schema: { comp } }));
  register(operation('layer.add_footage', 'layer', 'Add a footage layer.', { schema: { comp, name: comp } }));
  register(operation('layer.center', 'layer', 'Center selected layers.', { schema: { comp } }));
  register(operation('layer.set_transform', 'layer', 'Set a layer transform position.', {
    schema: { comp, index: layerIndex, position: { type: 'array' } },
  }));
  register(operation('layer.set_parent', 'layer', 'Parent a layer to another layer.', {
    schema: { comp, index: layerIndex, parent: layerIndex },
  }));
  register(operation('layer.delete', 'layer', 'Delete a layer.', {
    destructive: true,
    schema: { comp, index: layerIndex },
  }));
  register(operation('layer.bounds', 'layer', 'Report a layer bounds box.', {
    readOnly: true,
    schema: { comp, index: layerIndex },
  }));

  // Property.
  register(operation('property.get', 'property', 'Read a layer 1 property value.', {
    readOnly: true,
    schema: { comp, name: propertyName },
  }));
  register(operation('property.list', 'property', 'List layer properties.', {
    readOnly: true,
    schema: { comp },
  }));
  register(operation('property.set', 'property', 'Set a layer 1 property value.', {
    schema: { comp, name: propertyName, value: {} },
  }));

  // Keyframe.
  register(operation('keyframe.add', 'keyframe', 'Add a keyframe on a property.', {
    schema: { comp, index: layerIndex, time: { type: 'number' }, value: {}, property: propertyName },
  }));
  register(operation('keyframe.remove', 'keyframe', 'Remove a keyframe on a property.', {
    destructive: true,
    schema: { comp, index: layerIndex, time: { type: 'number' }, property: propertyName },
  }));
  register(
    operation('keyframe.set_easing', 'keyframe', 'Set easing on a keyframe.', {
      schema: {
        comp,
        index: layerIndex,
        time: { type: 'number' },
        easing: { type: 'string', enum: ['linear', 'ease', 'easeIn', 'easeOut', 'hold'] },
        property: propertyName,
      },
    }),
  );

  // Expression.
  register(operation('expression.set', 'expression', 'Set an expression on a layer 1 property.', {
    schema: { comp, property: propertyName, value: {} },
  }));
  register(operation('expression.clear', 'expression', 'Clear the expression on a layer 1 property.', {
    schema: { comp, property: propertyName },
  }));
  register(operation('expression.check_errors', 'expression', 'Check a layer 1 property expression errors.', {
    readOnly: true,
    schema: { comp, property: propertyName },
  }));

  // Effect (targets layer 1 unless the handler reads an index).
  register(operation('effect.apply', 'effect', 'Apply an effect to layer 1.', {
    schema: { comp, property: propertyName, value: {} },
  }));
  register(operation('effect.list_on_layer', 'effect', 'List effects on layer 1.', {
    readOnly: true,
    schema: { comp, property: propertyName },
  }));
  register(operation('effect.list_available', 'effect', 'List available effects.', {
    readOnly: true,
    schema: { comp },
  }));
  register(operation('effect.set_property', 'effect', 'Set an effect property on layer 1.', {
    schema: { comp, property: propertyName, value: {} },
  }));
  register(operation('effect.set_keyframe', 'effect', 'Set an effect property keyframe.', {
    schema: { comp, index: layerIndex, time: { type: 'number' }, value: {}, property: propertyName },
  }));
  register(operation('effect.remove', 'effect', 'Remove an effect from layer 1.', {
    destructive: true,
    schema: { comp, property: propertyName },
  }));
  register(operation('effect.apply_template', 'effect', 'Apply an effect template to layer 1.', {
    schema: { comp, template: comp },
  }));

  // Preset.
  register(operation('preset.apply_ffx', 'preset', 'Apply an .ffx preset to a layer.', {
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
    operation('shape.add', 'shape', 'Add a shape to a shape layer.', {
      schema: {
        comp,
        layerIndex,
        type: { type: 'string', enum: ['path', 'rect', 'ellipse'] },
        name: comp,
        size: { type: 'array' },
        vertices: { type: 'array' },
        inTangents: { type: 'array' },
        outTangents: { type: 'array' },
        closed: { type: 'boolean' },
        fillColor: { type: 'array' },
        strokeColor: { type: 'array' },
        strokeWidth: { type: 'number' },
      },
    }),
  );
  register(
    operation('shape.set', 'shape', 'Set the first vector path on a shape layer.', {
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
  register(operation('shape.read', 'shape', 'Read shape layer contents.', {
    readOnly: true,
    schema: { comp, layerIndex },
  }));

  // Text.
  register(operation('text.add', 'text', 'Add a text layer with optional styling.', {
    schema: { comp, text: comp, fontSize: { type: 'number' }, fillColor: { type: 'array' } },
  }));
  register(
    operation('text.set', 'text', 'Set text, font size or color on an existing text layer.', {
      schema: { comp, layerIndex, text: comp, fontSize: { type: 'number' }, fillColor: { type: 'array' } },
    }),
  );
  register(operation('text.read', 'text', 'Read text from a text layer.', {
    readOnly: true,
    schema: { comp, layerIndex },
  }));

  // Audio.
  register(operation('audio.set_levels', 'audio', 'Set audio levels on a layer.', {
    schema: { comp, layerIndex, levels: { type: 'array' } },
  }));
  register(operation('audio.info', 'audio', 'Report audio state on a layer.', {
    readOnly: true,
    schema: { comp, layerIndex },
  }));
  register(operation('audio.peaks_to_markers', 'audio', 'Write peak times as layer markers.', {
    schema: { comp, layerIndex, peaks: { type: 'array' } },
  }));

  // Render.
  register(
    operation('render.frame', 'render', 'Save a single frame of a composition as a PNG.', {
      readOnly: true,
      schema: { comp, time: { type: 'number' }, file: comp },
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
  register(
    operation('render.queue_start', 'render', 'Start the render queue and wait for it to finish.', {
      destructive: true,
    }),
  );
  register(operation('render.status', 'render', 'Report the render queue and item statuses.', {
    readOnly: true,
  }));

  // Font and command.
  register(operation('font.list', 'font', 'List installed fonts.', { readOnly: true }));
  register(operation('command.find', 'command', 'Find a menu command ID by name.', {
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
      schema: {
        comp,
        comps: { type: 'array' },
        layers: { type: 'array' },
        label: { type: 'number' },
        dryRun: { type: 'boolean' },
      },
    }),
  );

  // Batch (container; the E13 guard checks its sub-operations).
  register(
    operation('batch.run', 'batch', 'Run many operations as one undo group.', {
      schema: { ops: { type: 'array', items: { type: 'object' } } },
    }),
  );

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

/** Validates operation arguments against the operation's JSON-Schema-shaped property map. */
export function validateOperationArgs(
  schema: Record<string, unknown>,
  args: unknown,
): { ok: true; args: Record<string, unknown> } | { ok: false; message: string } {
  if (args === undefined || args === null) {
    return { ok: true, args: {} };
  }
  if (typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, message: 'arguments must be an object' };
  }
  const values = args as Record<string, unknown>;
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
