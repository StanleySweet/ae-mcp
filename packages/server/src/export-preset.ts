import { join } from 'node:path';

// Batch export presets (#240): one comp, several aspect ratios, one render job each.
// The resize is bulk.resize_comp; the render is ae_render (see server.ts export_preset).

export const EXPORT_FORMATS: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '21:9': { width: 2560, height: 1080 },
};

export const DEFAULT_EXPORT_PATTERN = '{comp} {format}';

const PATTERN_TOKENS = ['comp', 'format'];

export interface ExportTarget {
  format: string;
  /** Name of the resized copy in the project. */
  name: string;
  width: number;
  height: number;
  /** Full output path: the expanded pattern plus `.mov`. */
  output: string;
}

export interface ExportPresetInput {
  comp: string;
  formats: string[];
  outputDir: string;
  pattern?: string;
}

/**
 * Validates a preset and names every output. Throws an Error with a plain message
 * (unknown format, duplicate format, unknown pattern token) before anything runs.
 */
export function planExportPreset(input: ExportPresetInput): ExportTarget[] {
  if (input.formats.length === 0) {
    throw new Error('formats needs at least one format');
  }
  const allowed = Object.keys(EXPORT_FORMATS).join(', ');
  const seen = new Set<string>();
  for (const format of input.formats) {
    if (!Object.prototype.hasOwnProperty.call(EXPORT_FORMATS, format)) {
      throw new Error(`unknown format '${format}'; allowed formats: ${allowed}`);
    }
    if (seen.has(format)) {
      throw new Error(`format '${format}' is listed twice`);
    }
    seen.add(format);
  }
  const pattern = input.pattern ?? DEFAULT_EXPORT_PATTERN;
  for (const match of pattern.matchAll(/\{(\w+)\}/g)) {
    if (!PATTERN_TOKENS.includes(match[1] ?? '')) {
      throw new Error(`unknown pattern token '{${match[1]}}'; allowed tokens: {comp}, {format}`);
    }
  }
  return input.formats.map((format) => {
    const size = EXPORT_FORMATS[format]!;
    const name = `${input.comp} ${format}`;
    const base = pattern
      .replace(/\{comp\}/g, sanitize(input.comp))
      .replace(/\{format\}/g, sanitize(format.replace(':', 'x')));
    return { format, name, width: size.width, height: size.height, output: join(input.outputDir, `${base}.mov`) };
  });
}

/** File-name safe text: path separators and characters macOS or aerender reject become `_`. */
function sanitize(text: string): string {
  return text.replace(/[\\:*?"<>|/]/g, '_');
}
