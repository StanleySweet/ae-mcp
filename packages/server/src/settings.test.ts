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
    expect(DEFAULT_SETTINGS.backupMode).toBe('single');
    expect(DEFAULT_SETTINGS.backupKeep).toBe(5);
  });

  it('reads values from settings.json', async () => {
    const root = await settingsRoot();
    await writeSettings(root, {
      readOnly: true,
      allowedCategories: ['project'],
      evalEnabled: true,
      backupMode: 'increment',
      backupKeep: 3,
    });
    expect(await loadSettings({ root, env: {} })).toEqual({
      readOnly: true,
      allowedCategories: ['project'],
      evalEnabled: true,
      backupMode: 'increment',
      backupKeep: 3,
    });
  });

  it('lets environment variables override the file', async () => {
    const root = await settingsRoot();
    await writeSettings(root, {
      readOnly: false,
      allowedCategories: ['project'],
      evalEnabled: false,
      backupMode: 'single',
    });
    const settings = await loadSettings({
      root,
      env: {
        AE_MCP_READ_ONLY: '1',
        AE_MCP_ALLOWED_CATEGORIES: 'layer,comp',
        AE_MCP_EVAL_ENABLED: 'true',
        AE_MCP_BACKUP_MODE: 'off',
        AE_MCP_BACKUP_KEEP: '7',
      },
    });
    expect(settings).toEqual({
      readOnly: true,
      allowedCategories: ['layer', 'comp'],
      evalEnabled: true,
      backupMode: 'off',
      backupKeep: 7,
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

  it('rejects an unknown backupMode in the file or the environment', async () => {
    const root = await settingsRoot();
    await writeSettings(root, { backupMode: 'many' });
    await expect(loadSettings({ root, env: {} })).rejects.toThrow();
    await writeSettings(root, {});
    await expect(loadSettings({ root, env: { AE_MCP_BACKUP_MODE: 'many' } })).rejects.toThrow(/AE_MCP_BACKUP_MODE/);
  });

  it('rejects a backupKeep that is not a positive whole number', async () => {
    const root = await settingsRoot();
    await writeSettings(root, { backupKeep: 0 });
    await expect(loadSettings({ root, env: {} })).rejects.toThrow();
    await writeSettings(root, {});
    await expect(loadSettings({ root, env: { AE_MCP_BACKUP_KEEP: 'two' } })).rejects.toThrow(/AE_MCP_BACKUP_KEEP/);
  });

  it('maps the legacy incrementBeforeDestructive switch: false is off, true is increment', async () => {
    const root = await settingsRoot();
    await writeSettings(root, { incrementBeforeDestructive: false });
    expect((await loadSettings({ root, env: {} })).backupMode).toBe('off');
    await writeSettings(root, { incrementBeforeDestructive: true });
    expect((await loadSettings({ root, env: {} })).backupMode).toBe('increment');
  });

  it('keeps the default single mode when the legacy switch is absent', async () => {
    const root = await settingsRoot();
    await writeSettings(root, { evalEnabled: true });
    expect((await loadSettings({ root, env: {} })).backupMode).toBe('single');
  });

  it('prefers backupMode over the legacy switch when both are in the file', async () => {
    const root = await settingsRoot();
    await writeSettings(root, { backupMode: 'single', incrementBeforeDestructive: false });
    expect((await loadSettings({ root, env: {} })).backupMode).toBe('single');
  });

  it('maps the legacy environment variable and lets AE_MCP_BACKUP_MODE win over it', async () => {
    const root = await settingsRoot();
    expect((await loadSettings({ root, env: { AE_MCP_INCREMENT_BEFORE_DESTRUCTIVE: 'false' } })).backupMode).toBe(
      'off',
    );
    expect(
      (
        await loadSettings({
          root,
          env: { AE_MCP_INCREMENT_BEFORE_DESTRUCTIVE: 'false', AE_MCP_BACKUP_MODE: 'increment' },
        })
      ).backupMode,
    ).toBe('increment');
  });
});
