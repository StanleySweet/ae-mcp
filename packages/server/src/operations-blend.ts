import type { OperationDefinition } from '@ae-mcp/protocol';

// Layer blending mode. The handler is packages/bridge/src/handlers-blend.js.
export function registerBlendOperations(register: (d: OperationDefinition) => void): void {
  register({
    name: 'layer.set_blend_mode',
    category: 'layer',
    description: "Set a layer's blending mode: screen, add, overlay, soft_light, multiply, normal, and the other AE modes in snake case.",
    readOnly: false,
    destructive: false,
    schema: {
      comp: { type: 'string' },
      index: { type: 'number' },
      layer: {},
      mode: { type: 'string' },
    },
    required: ['mode'],
  });
}
