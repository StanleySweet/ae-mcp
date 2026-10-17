import type { OperationDefinition } from '@ae-mcp/protocol';

// Render template names for ae_render validation (E16-2). Read-only; adds and removes a
// temporary render queue item, never renders.
export function registerRenderTemplateOperations(register: (d: OperationDefinition) => void): void {
  register({
    name: 'render.templates',
    category: 'render',
    description: 'List the output-module and render-settings template names of this After Effects (localised).',
    readOnly: true,
    destructive: false,
    schema: { comp: {} },
  });
}
