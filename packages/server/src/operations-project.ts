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
  // Report only; fix: true applies the safe findings through ae_plan and ae_apply (#244).
  register(
    operation('project.lint', 'project', 'Lint the project: unused items, missing footage, expression errors and naming-rule violations (naming.pattern regex; naming.fix {match, replace, regex, flags} makes a rename a safe fix). Returns findings with severity and fix.safe. fix: true applies only the safe fixes; the rest are listed, not applied.', {
      schema: {
        comp: { type: 'string' },
        naming: { type: 'object' },
        fix: { type: 'boolean' },
      },
    }),
  );
}
