import type { OperationCategory, OperationDefinition } from '@ae-mcp/protocol';

type Register = (definition: OperationDefinition) => void;

// Same shape as the `operation` helper in operations.ts (not exported there).
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

// Project housekeeping: folder import, reduce and footage consolidation.
export function registerHousekeepingOperations(register: Register): void {
  register(
    operation('project.import_folder', 'project', 'Import every visible file under a folder into a project folder named after it (or folder). Files AE refuses are reported in skipped.', {
      schema: {
        path: { type: 'string' },
        recursive: { type: 'boolean' },
        folder: { type: 'string' },
      },
    }),
  );
  register(
    operation('project.reduce', 'project', 'Remove everything from the project except the given comps (File > Reduce Project). Destructive.', {
      destructive: true,
      schema: {
        items: { type: 'array', items: { oneOf: [{ type: 'number' }, { type: 'string' }] } },
      },
    }),
  );
  register(
    operation('project.consolidate_footage', 'project', 'Consolidate all duplicate footage in the project (File > Consolidate All Footage). Destructive.', {
      destructive: true,
    }),
  );
}
