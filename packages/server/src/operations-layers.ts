import type { OperationCategory, OperationDefinition } from '@ae-mcp/protocol';
import { withLayerRef } from './operations-layer-ref.js';

// Layer operations that live outside operations.ts (#215). Mirrors the
// `operation(...)` helper there; kept local so operations.ts can import this file.
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
  const { schema, required } = withLayerRef(options.schema ?? {}, options.required ?? []);
  return {
    name,
    category,
    description,
    readOnly: options.readOnly ?? false,
    destructive: options.destructive ?? false,
    schema,
    required,
  };
}

export function registerLayerOperations(register: (d: OperationDefinition) => void): void {
  register(operation('layer.rename', 'layer', 'Rename a layer.', {
      required: ['index', 'name'],
    schema: { comp: { type: 'string' }, index: { type: 'number' }, name: { type: 'string' } },
  }));
}
