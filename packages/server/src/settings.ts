import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { queueRoot } from '@ae-mcp/protocol';
import { z } from 'zod';

export const settingsSchema = z
  .object({
    readOnly: z.boolean().optional(),
    allowedCategories: z.array(z.string()).nullable().optional(),
    evalEnabled: z.boolean().optional(),
    incrementBeforeDestructive: z.boolean().optional(),
  })
  .strict();

export interface Settings {
  readOnly: boolean;
  allowedCategories: string[] | null;
  evalEnabled: boolean;
  incrementBeforeDestructive: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  readOnly: false,
  allowedCategories: null,
  evalEnabled: false,
  incrementBeforeDestructive: true,
};

export function settingsPath(root: string): string {
  return join(root, 'settings.json');
}

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }
  return value === '1' || value.toLowerCase() === 'true';
}

export async function loadSettings(
  options: { root?: string; env?: Record<string, string | undefined> } = {},
): Promise<Settings> {
  const root = options.root ?? queueRoot();
  const env = options.env ?? process.env;

  let fromFile: z.infer<typeof settingsSchema> = {};
  let raw: string | null = null;
  try {
    raw = await readFile(settingsPath(root), 'utf8');
  } catch {
    raw = null;
  }
  if (raw !== null) {
    fromFile = settingsSchema.parse(JSON.parse(raw));
  }

  const categories = env.AE_MCP_ALLOWED_CATEGORIES;
  return {
    readOnly: envBool(env.AE_MCP_READ_ONLY, fromFile.readOnly ?? DEFAULT_SETTINGS.readOnly),
    allowedCategories:
      categories === undefined
        ? (fromFile.allowedCategories ?? DEFAULT_SETTINGS.allowedCategories)
        : categories === ''
          ? null
          : categories.split(','),
    evalEnabled: envBool(env.AE_MCP_EVAL_ENABLED, fromFile.evalEnabled ?? DEFAULT_SETTINGS.evalEnabled),
    incrementBeforeDestructive: envBool(
      env.AE_MCP_INCREMENT_BEFORE_DESTRUCTIVE,
      fromFile.incrementBeforeDestructive ?? DEFAULT_SETTINGS.incrementBeforeDestructive,
    ),
  };
}
