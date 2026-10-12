import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from './diagnostics.js';

describe('formatDiagnostics', () => {
  it('lists AE installs, Claude Desktop and runtime details', () => {
    const report = formatDiagnostics({
      environment: {
        afterEffects: [
          { appName: 'Adobe After Effects 2026', year: 2026, path: '/Applications/AE.app' },
        ],
        claudeDesktop: {
          appName: 'Claude',
          path: '/Applications/Claude.app',
          configDir: '/cfg',
          configPath: '/cfg/c.json',
        },
      },
      now: new Date('2026-10-12T00:00:00Z'),
      platform: 'darwin',
      arch: 'arm64',
      nodeVersion: 'v22.0.0',
    });

    expect(report).toContain('Generated: 2026-10-12T00:00:00.000Z');
    expect(report).toContain('Platform: darwin (arm64)');
    expect(report).toContain('Node: v22.0.0');
    expect(report).toContain('- Adobe After Effects 2026 (2026) /Applications/AE.app');
    expect(report).toContain('- /Applications/Claude.app');
  });

  it('marks missing After Effects and Claude', () => {
    const report = formatDiagnostics({
      environment: { afterEffects: [], claudeDesktop: null },
      now: new Date('2026-10-12T00:00:00Z'),
    });

    expect(report).toContain('(none found)');
    expect(report).toContain('(not found)');
  });
});
