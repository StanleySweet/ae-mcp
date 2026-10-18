import type { OperationCategory, OperationDefinition } from '@ae-mcp/protocol';

// Animate (#260). Same `operation(...)` helper shape as operations.ts; kept here so this
// file does not import from its own caller.
function operation(
  name: string,
  category: OperationCategory,
  description: string,
  options: { schema?: Record<string, unknown>; required?: string[] } = {},
): OperationDefinition {
  return {
    name,
    category,
    description,
    readOnly: false,
    destructive: false,
    schema: options.schema ?? {},
    required: options.required ?? [],
  };
}

export function registerAnimateOperations(register: (d: OperationDefinition) => void): void {
  register(operation('animate', 'keyframe', 'Set keys on several properties of one layer in one call and ease each key from a cubic-bezier curve, so speed follows the distance travelled. Pass tracks: {"ADBE Opacity": [[time, value], ...]} with curve (linear, smooth, expo_in, expo_out, expo_in_out, back_out, snappy, or [x1, y1, x2, y2]; default smooth), or pass preset: fade_in, slide_in (direction left/right/up/down, distance) or pop, with start and duration. The first and last keys get speed 0 on their outer side.', {
    required: ['layer'],
    schema: {
      comp: { type: 'string' },
      layer: {},
      tracks: { type: 'object' },
      curve: {},
      preset: { type: 'string' },
      start: { type: 'number' },
      duration: { type: 'number' },
      distance: { type: 'number' },
      direction: { type: 'string' },
    },
  }));
}
