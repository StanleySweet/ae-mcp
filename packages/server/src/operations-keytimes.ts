import type { OperationDefinition } from '@ae-mcp/protocol';

// Key-time read for ae_render_frame atKeys (E15-5). Read-only.
export function registerKeyTimeOperations(register: (d: OperationDefinition) => void): void {
  register({
    name: 'keyframe.times',
    category: 'keyframe',
    description: 'List the key times (seconds, sorted, values left out) of one layer (index or layer) or of every layer in the comp.',
    readOnly: true,
    destructive: false,
    schema: { comp: { type: 'string' }, index: { type: 'number' }, layer: {} },
  });
}
