import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings } from './settings.js';

async function settingsRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ae-mcp-settings-'));
}

async function writeSettings(root: string, value: unknown): Promise<void> {
  await writeFile(join(root, 'settings.json'), JSON.stringify(value));
}

describe('loadSettings', () => {
  it('returns defaults when there is no settings file', async () => {
    const root = await settingsRoot();
    expect(await loadSettings({ root, env: {} })).toEqual(DEFAULT_SETTINGS);
  });

  it('reads values from settings.json', async () => {
    const root = await settingsRoot();
    await writeSettings(root, {
      readOnly: true,
      allowedCategories: ['project'],
      evalEnabled: true,
      incrementBeforeDestructive: false,
    });
    expect(await loadSettings({ root, env: {} })).toEqual({
      readOnly: true,
      allowedCategories: ['project'],
      evalEnabled: true,
      incrementBeforeDestructive: false,
    });
  });

  it('lets environment variables override the file', async () => {
    const root = await settingsRoot();
    await writeSettings(root, {
      readOnly: false,
      allowedCategories: ['project'],
      evalEnabled: false,
      incrementBeforeDestructive: true,
    });
    const settings = await loadSettings({
      root,
      env: {
        AE_MCP_READ_ONLY: '1',
        AE_MCP_ALLOWED_CATEGORIES: 'layer,comp',
        AE_MCP_EVAL_ENABLED: 'true',
        AE_MCP_INCREMENT_BEFORE_DESTRUCTIVE: 'false',
      },
    });
    expect(settings).toEqual({
      readOnly: true,
      allowedCategories: ['layer', 'comp'],
      evalEnabled: true,
      incrementBeforeDestructive: false,
    });
  });

  it('treats an empty allowlist override as no allowlist', async () => {
    const root = await settingsRoot();
    await writeSettings(root, { allowedCategories: ['project'] });
    expect((await loadSettings({ root, env: { AE_MCP_ALLOWED_CATEGORIES: '' } })).allowedCategories).toBe(
      null,
    );
  });

  it('rejects an unknown settings key', async () => {
    const root = await settingsRoot();
    await writeSettings(root, { nonsense: true });
    await expect(loadSettings({ root, env: {} })).rejects.toThrow();
  });

  it('rejects malformed JSON', async () => {
    const root = await settingsRoot();
    await writeFile(join(root, 'settings.json'), '{ not json');
    await expect(loadSettings({ root, env: {} })).rejects.toThrow();
  });
});
