import type { OperationCategory, OperationDefinition } from '@ae-mcp/protocol';

// Template and look operations (#217). Same `operation(...)` helper shape as
// operations.ts; kept here so this file does not import from its own caller.
function operation(
  name: string,
  category: OperationCategory,
  description: string,
  options: { schema?: Record<string, unknown> } = {},
): OperationDefinition {
  return {
    name,
    category,
    description,
    readOnly: false,
    destructive: false,
    schema: options.schema ?? {},
  };
}

const comp = { type: 'string' };
const layerIndex = { type: 'number' };

export function registerTemplateOperations(register: (d: OperationDefinition) => void): void {
  register(operation('template.title_card', 'template', 'Build a title card: a dark full-comp solid, a centred title that fades and scales in over 0.6 s, and an optional subtitle below. duration is the on-screen time in seconds (default 4). Returns the created layer indices.', {
    schema: { comp, title: { type: 'string' }, subtitle: { type: 'string' }, duration: { type: 'number' } },
  }));
  register(operation('template.transition', 'template', 'Overlap layer `to` onto layer `from`: `to` starts at from\'s out point minus duration. fade crossfades Opacity; push slides from out left and to in from the right; zoom scales `from` up while fading it out.', {
    schema: {
      comp,
      from: layerIndex,
      to: layerIndex,
      style: { type: 'string', enum: ['fade', 'push', 'zoom'] },
      duration: { type: 'number' },
    },
  }));
  register(operation('template.logo_reveal', 'template', 'Animate one layer in over 0.8 s from its in point: fade_scale (Opacity 0 to 100, Scale 80 to 100), slide (Position starts 200 px below), or spin (Rotation -90 to 0 with Opacity 0 to 100).', {
    schema: {
      comp,
      index: layerIndex,
      style: { type: 'string', enum: ['fade_scale', 'slide', 'spin'] },
    },
  }));
  register(operation('look.apply', 'effect', 'Add a first-party look effect to a layer: glow (Glow), soft_blur (Gaussian Blur), film_grain (Noise), drop_shadow (Drop Shadow) or vignette (CC Vignette). Parameters stay at their defaults.', {
    schema: {
      comp,
      index: layerIndex,
      look: { type: 'string', enum: ['glow', 'vignette', 'film_grain', 'soft_blur', 'drop_shadow'] },
    },
  }));
}
