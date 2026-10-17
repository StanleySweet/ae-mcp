import type { OperationCategory, OperationDefinition } from '@ae-mcp/protocol';

// Data-driven versions (#239). Same `operation(...)` helper shape as operations.ts;
// kept here so this file does not import from its own caller.
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

export function registerVersionOperations(register: (d: OperationDefinition) => void): void {
  register(operation('versions.generate', 'bulk', 'Duplicate a template comp once per version and apply each version\'s plain values to its copy: texts (layer name to string) and footage (layer name to file path, imported once per path). The template is not changed. Defaults dryRun true, which returns the plan; ae_plan and ae_apply, or versions_generate, apply it.', {
    required: ['comp', 'versions'],
    schema: {
      comp: { type: 'string' },
      versions: { type: 'array' },
      dryRun: { type: 'boolean' },
    },
  }));
}
