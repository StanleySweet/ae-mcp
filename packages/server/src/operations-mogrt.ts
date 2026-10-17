import type { OperationCategory, OperationDefinition } from '@ae-mcp/protocol';

// Motion Graphics Template export (#241). Same `operation(...)` helper shape as
// operations.ts; kept here so this file does not import from its own caller.
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

export function registerMogrtOperations(register: (d: OperationDefinition) => void): void {
  register(operation('mogrt.export', 'comp', 'Export a comp as a Motion Graphics Template (.mogrt) at path, named after the comp. Refuses an existing file unless overwrite is true. controls adds layer properties to the Essential Graphics panel first ({layer index, property match name or name, name}). Returns the file path and the panel controls, in order.', {
    required: ['path'],
    schema: {
      comp: { type: 'string' },
      path: { type: 'string' },
      overwrite: { type: 'boolean' },
      controls: { type: 'array' },
    },
  }));
}
