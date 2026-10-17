import type { OperationCategory, OperationDefinition } from '@ae-mcp/protocol';

// Layer operations that live outside operations.ts (#215). Mirrors the
// `operation(...)` helper there; kept local so operations.ts can import this file.
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

export function registerLayerOperations(register: (d: OperationDefinition) => void): void {
  register(operation('layer.rename', 'layer', 'Rename a layer.', {
    schema: { comp: { type: 'string' }, index: { type: 'number' }, name: { type: 'string' } },
  }));
}
