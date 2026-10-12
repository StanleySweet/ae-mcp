import type { DetectedEnvironment, InstallerCheck } from '@ae-mcp/core';
import { describe, expect, it } from 'vitest';
import { buildChecklist } from './checklist.js';

const everything: DetectedEnvironment = {
  afterEffects: [
    { appName: 'Adobe After Effects 2026', year: 2026, path: '/Applications/AE 2026.app' },
  ],
  claudeDesktop: {
    appName: 'Claude',
    path: '/Applications/Claude.app',
    configDir: '/Users/x/Library/Application Support/Claude',
    configPath: '/Users/x/Library/Application Support/Claude/claude_desktop_config.json',
  },
};

describe('buildChecklist', () => {
  it('lists the six canonical rows in order', () => {
    expect(buildChecklist(everything).map((row) => row.id)).toEqual([
      'after_effects',
      'claude',
      'bridge_payload',
      'scripting_pref',
      'claude_extension',
      'live_test',
    ]);
  });

  it('marks missing AE and Claude as failures with a fix', () => {
    const rows = buildChecklist({ afterEffects: [], claudeDesktop: null });
    expect(rows[0]).toMatchObject({ id: 'after_effects', status: 'fail' });
    expect(rows[0].fix).toBeTruthy();
    expect(rows[1]).toMatchObject({ id: 'claude', status: 'fail' });
    expect(rows[1].fix).toBeTruthy();
  });

  it('marks found AE and Claude as ok and leaves the rest pending', () => {
    const rows = buildChecklist(everything);
    expect(rows[0]).toMatchObject({ status: 'ok' });
    expect(rows[1]).toMatchObject({ status: 'ok' });
    expect(rows.slice(2).every((row) => row.status === 'pending')).toBe(true);
  });

  it('merges install check results into the rows', () => {
    const checks: InstallerCheck[] = [
      { check: 'bridge_payload', status: 'ok' },
      { check: 'live_test', status: 'fail', fix: 'Reopen After Effects.' },
    ];
    const rows = buildChecklist(everything, checks);
    expect(rows.find((row) => row.id === 'bridge_payload')).toMatchObject({ status: 'ok' });
    expect(rows.find((row) => row.id === 'live_test')).toMatchObject({
      status: 'fail',
      fix: 'Reopen After Effects.',
    });
    expect(rows.find((row) => row.id === 'scripting_pref')?.status).toBe('pending');
  });

  it('exposes stable labels', () => {
    for (const item of buildChecklist(everything)) {
      expect(typeof item.label).toBe('string');
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});
