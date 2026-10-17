import type { OperationCategory, OperationDefinition } from '@ae-mcp/protocol';

// Localization with fit-to-box (#243). Same `operation(...)` helper shape as
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

export function registerLocalizeOperations(register: (d: OperationDefinition) => void): void {
  register(operation('localize.apply', 'text', 'Translate text layers in one or more comps: each table entry (source text to translation) is replaced through bulk.replace_text, then the font of every changed layer shrinks until the translation fits the box the layer had before (measured with sourceRectAtTime), down to minFontSize (default 8). Returns changes (comp, index, oldText, newText, fontSize) and unfit (text left at minFontSize that still does not fit). Changes text: undo with Cmd+Z.', {
    required: ['table'],
    schema: {
      comps: { type: 'array' },
      comp: { type: 'string' },
      table: { type: 'object' },
      minFontSize: { type: 'number' },
    },
  }));
}
