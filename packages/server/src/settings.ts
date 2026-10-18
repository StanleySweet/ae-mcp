import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { queueRoot } from '@ae-mcp/protocol';
import { z } from 'zod';

/** What a destructive operation saves first: one backup file, a timestamped copy per call, or nothing (ADR-0012). */
export const BACKUP_MODES = ['single', 'increment', 'off'] as const;
export type BackupMode = (typeof BACKUP_MODES)[number];

export const settingsSchema = z
  .object({
    readOnly: z.boolean().optional(),
    allowedCategories: z.array(z.string()).nullable().optional(),
    evalEnabled: z.boolean().optional(),
    backupMode: z.enum(BACKUP_MODES).optional(),
    backupKeep: z.number().int().positive().optional(),
    /** Legacy switch (before ADR-0012): false maps to "off", true to "increment". */
    incrementBeforeDestructive: z.boolean().optional(),
  })
  .strict();

export interface Settings {
  readOnly: boolean;
  allowedCategories: string[] | null;
  evalEnabled: boolean;
  backupMode: BackupMode;
  backupKeep: number;
}

export const DEFAULT_SETTINGS: Settings = {
  readOnly: false,
  allowedCategories: null,
  evalEnabled: false,
  backupMode: 'single',
  backupKeep: 5,
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

function legacyMode(enabled: boolean): BackupMode {
  return enabled ? 'increment' : 'off';
}

// An invalid environment value is ignored (the file or the default applies), so a typo in a
// client config does not make every tool fail.
function parseBackupMode(value: string): BackupMode | null {
  return (BACKUP_MODES as readonly string[]).includes(value) ? (value as BackupMode) : null;
}

function parseBackupKeep(value: string): number | null {
  return /^[1-9]\d*$/.test(value) ? Number(value) : null;
}

/**
 * Precedence: AE_MCP_BACKUP_MODE, then the legacy AE_MCP_INCREMENT_BEFORE_DESTRUCTIVE,
 * then backupMode in settings.json, then the legacy incrementBeforeDestructive, then "single".
 */
function resolveBackupMode(
  file: z.infer<typeof settingsSchema>,
  env: Record<string, string | undefined>,
): BackupMode {
  const fromEnv = env.AE_MCP_BACKUP_MODE ? parseBackupMode(env.AE_MCP_BACKUP_MODE) : null;
  if (fromEnv !== null) {
    return fromEnv;
  }
  if (env.AE_MCP_INCREMENT_BEFORE_DESTRUCTIVE) {
    return legacyMode(envBool(env.AE_MCP_INCREMENT_BEFORE_DESTRUCTIVE, true));
  }
  if (file.backupMode !== undefined) {
    return file.backupMode;
  }
  if (file.incrementBeforeDestructive !== undefined) {
    return legacyMode(file.incrementBeforeDestructive);
  }
  return DEFAULT_SETTINGS.backupMode;
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
    backupMode: resolveBackupMode(fromFile, env),
    backupKeep:
      (env.AE_MCP_BACKUP_KEEP ? parseBackupKeep(env.AE_MCP_BACKUP_KEEP) : null) ??
      fromFile.backupKeep ??
      DEFAULT_SETTINGS.backupKeep,
  };
}
