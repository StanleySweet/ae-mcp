import type { OperationDefinition } from '@ae-mcp/protocol';

// Keyframe clearing, layer timing and source replacement (#286).
// The handlers are packages/bridge/src/handlers-timing.js.
export function registerTimingOperations(register: (d: OperationDefinition) => void): void {
  register({
    name: 'keyframe.clear',
    category: 'keyframe',
    description:
      'Remove every keyframe of a property (or those between from and to, in seconds). The property keeps its value at the comp time. Returns removed and remaining counts.',
    readOnly: false,
    destructive: true,
    schema: {
      comp: { type: 'string' },
      layer: {},
      property: { type: 'string' },
      from: { type: 'number' },
      to: { type: 'number' },
    },
    required: ['property'],
  });
  register({
    name: 'layer.set_timing',
    category: 'layer',
    description: "Set a layer's startTime, inPoint and/or outPoint in seconds of comp time (at least one required).",
    readOnly: false,
    destructive: false,
    schema: {
      comp: { type: 'string' },
      layer: {},
      startTime: { type: 'number' },
      inPoint: { type: 'number' },
      outPoint: { type: 'number' },
    },
    required: [],
  });
  register({
    name: 'layer.replace_source',
    category: 'layer',
    description:
      'Replace the source of an AV layer with a footage or comp item (item by name or id). fixExpressions adjusts expressions for the new source (slow).',
    readOnly: false,
    destructive: false,
    schema: {
      comp: { type: 'string' },
      layer: {},
      item: {},
      fixExpressions: { type: 'boolean' },
    },
    required: ['item'],
  });
}
