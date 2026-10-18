import type { OperationDefinition } from '@ae-mcp/protocol';

// Verification ops (#216): comp snapshot/diff and property sampling. All read-only.
export function registerVerifyOperations(register: (d: OperationDefinition) => void): void {
  const comp = { type: 'string' };
  const layerIndex = { type: 'number' };

  register({
    name: 'comp.snapshot',
    category: 'comp',
    description: 'Compact JSON snapshot of a comp: each layer with index, name, type, in/out, parent, transform values, effect match names and expression flags.',
    readOnly: true,
    destructive: false,
    schema: { comp },
  });
  register({
    name: 'comp.diff',
    category: 'comp',
    description: 'Compare the comp with a snapshot from comp.snapshot: added and removed layers (by index and name) and changed fields.',
    readOnly: true,
    destructive: false,
    required: ['snapshot'],
    schema: { comp, snapshot: { type: 'object' } },
  });
  register({
    name: 'property.sample',
    category: 'property',
    description: 'Sample a layer property at the given times (Property.valueAtTime).',
    readOnly: true,
    destructive: false,
    required: ['property', 'times'],
    schema: { comp, layer: {}, index: layerIndex, property: { type: 'string' }, times: { type: 'array' } },
  });
}
