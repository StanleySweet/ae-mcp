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

// Project lifecycle operations (handlers in packages/bridge/src/handlers-project.js).
export function registerProjectOperations(register: Register): void {
  register(
    operation('project.new', 'project', 'Open a fresh untitled project (File > New > New Project). Refuses while the open project has unsaved changes unless force: true, which discards them without a save prompt. Destructive.', {
      destructive: true,
      schema: { force: { type: 'boolean' } },
    }),
  );
}
