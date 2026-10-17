import type { OperationCategory, OperationDefinition } from '@ae-mcp/protocol';

type Register = (definition: OperationDefinition) => void;

// Same shape as the `operation` helper in operations.ts (not exported there).
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
  return {
    name,
    category,
    description,
    readOnly: options.readOnly ?? false,
    destructive: options.destructive ?? false,
    schema: options.schema ?? {},
    required: options.required ?? [],
  };
}

// eval.run is hidden from ae_catalog and refused by ae_do unless settings.evalEnabled
// (policy.ts evalRunEnabled), so registering it here adds nothing for default users.
export function registerEvalOperations(register: Register): void {
  register(
    operation(
      'eval.run',
      'eval',
      'Run ExtendScript code in After Effects and return the value of its last expression. Off unless eval is enabled in settings; always destructive (incremental save first).',
      {
        destructive: true,
        schema: { code: { type: 'string' } },
        required: ['code'],
      },
    ),
  );
}
