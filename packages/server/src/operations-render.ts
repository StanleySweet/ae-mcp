import type { OperationDefinition } from '@ae-mcp/protocol';

// Render queue cleanup (E16-6). The handler is packages/bridge/src/handlers-render-queue.js.
export function registerRenderOperations(register: (d: OperationDefinition) => void): void {
  register({
    name: 'render.queue_remove',
    category: 'render',
    description: 'Remove one render queue item by index, or every item with all: true. Project data is unchanged.',
    readOnly: false,
    destructive: false,
    schema: { index: { type: 'number' }, all: { type: 'boolean' } },
    required: [],
  });
}
