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

// Relink missing footage from a folder. Dry run unless apply is true.
export function registerRelinkOperations(register: Register): void {
  register(
    operation('footage.relink', 'footage', 'Match missing footage to files in a folder by file name. Dry run unless apply: true, which relinks each unique match through footage.replace. Ambiguous and unmatched items are reported, never relinked.', {
      required: ['folder'],
      schema: {
        folder: { type: 'string' },
        recursive: { type: 'boolean' },
        apply: { type: 'boolean' },
      },
    }),
  );
}
