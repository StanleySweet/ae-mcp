import type { OperationCategory, OperationDefinition } from '@ae-mcp/protocol';

// Template and look operations (#217, #225). Same `operation(...)` helper shape as
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

const comp = { type: 'string' };
const layerIndex = { type: 'number' };

export function registerTemplateOperations(register: (d: OperationDefinition) => void): void {
  register(operation('template.title_card', 'template', 'Build a title card: a full-comp solid, a centred title that fades in over the style\'s fade time (default and cinematic also scale), and an optional subtitle below. style: default (dark, scale-in, 0.6 s fade), cinematic (black, 1.5 s fade, no scale) or minimal (light background, dark type, 0.4 s fade). duration is the on-screen time in seconds (default 4). Returns the created layer indices.', {
      required: ['title'],
    schema: {
      comp,
      title: { type: 'string' },
      subtitle: { type: 'string' },
      duration: { type: 'number' },
      style: { type: 'string', enum: ['default', 'cinematic', 'minimal'] },
    },
  }));
  register(operation('template.transition', 'template', 'Overlap layer `to` onto layer `from`: `to` starts at from\'s out point minus duration. fade crossfades Opacity; push slides from out left and to in from the right; zoom scales `from` up while fading it out; wipe keys the Linear Wipe effect on `from` (Completion 0 to 100), revealing `to`.', {
      required: ['style', 'from', 'to'],
    schema: {
      comp,
      from: layerIndex,
      to: layerIndex,
      style: { type: 'string', enum: ['fade', 'push', 'zoom', 'wipe'] },
      duration: { type: 'number' },
    },
  }));
  register(operation('template.logo_reveal', 'template', 'Animate one layer in over 0.8 s from its in point: fade_scale (Opacity 0 to 100, Scale 80 to 100), slide (Position starts 200 px below), spin (Rotation -90 to 0 with Opacity 0 to 100), or glitch (Turbulent Displace amount 60 to 0, and a flickering Opacity expression).', {
      required: ['style', 'index'],
    schema: {
      comp,
      index: layerIndex,
      style: { type: 'string', enum: ['fade_scale', 'slide', 'spin', 'glitch'] },
    },
  }));
  register(operation('look.apply', 'effect', 'Add a first-party look effect to a layer with tuned starting parameters: glow (Glow), soft_blur (Gaussian Blur), film_grain (Noise), drop_shadow (Drop Shadow), vignette (CC Vignette), neon (strong Glow), vhs (Noise plus Turbulent Displace), chromatic (Turbulent Displace), duotone (Tint with two colours), cinematic (Brightness & Contrast plus CC Vignette).', {
      required: ['index', 'look'],
    schema: {
      comp,
      index: layerIndex,
      look: { type: 'string', enum: ['glow', 'vignette', 'film_grain', 'soft_blur', 'drop_shadow', 'neon', 'vhs', 'chromatic', 'duotone', 'cinematic'] },
    },
  }));
}
