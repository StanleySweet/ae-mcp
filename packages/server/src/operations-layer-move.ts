import type { OperationDefinition } from '@ae-mcp/protocol';

// Layer stacking order (E16-5): move one layer to the top, the bottom, or next to another layer.
// The handler is packages/bridge/src/handlers-layer-move.js.
export function registerLayerMoveOperations(register: (d: OperationDefinition) => void): void {
  register({
    name: 'layer.move',
    category: 'layer',
    description:
      "Move a layer in the stack: to 'top', 'bottom', or 'before'/'after' a target layer (index, name or {id}). Returns the new index.",
    readOnly: false,
    destructive: false,
    schema: {
      comp: { type: 'string' },
      index: { type: 'number' },
      layer: {},
      to: { type: 'string', enum: ['top', 'bottom', 'before', 'after'] },
      target: {},
    },
    required: ['to'],
  });
}
