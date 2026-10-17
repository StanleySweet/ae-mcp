import type { OperationCategory, OperationDefinition } from '@ae-mcp/protocol';

// Audio-driven animation (#242). Same `operation(...)` helper shape as operations.ts;
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

export function registerAudioOperations(register: (d: OperationDefinition) => void): void {
  register(operation('audio.to_keyframes', 'audio', 'Turn the loudness of an audio layer into keyframes on a property of a target layer, one keyframe per comp frame. Loudness is the louder Audio Levels channel: -60 dB or less maps to 0, 0 dB to the full value `scale` (default 100). Refuses a property that already has keyframes. cuts lists times in seconds (for example the beat times from audio.peaks_to_markers): the keyframe nearest each one is held, so the value steps there.', {
    required: ['audioLayer', 'targetLayer', 'property'],
    schema: {
      comp: { type: 'string' },
      audioLayer: { type: 'number' },
      targetLayer: { type: 'number' },
      property: { type: 'string' },
      scale: { type: 'number' },
      cuts: { type: 'array' },
    },
  }));
}
