import { arch, platform } from 'node:os';
import type { DetectedEnvironment } from './environment.js';

export interface DiagnosticsInput {
  environment: DetectedEnvironment;
  now?: Date;
  platform?: string;
  arch?: string;
  nodeVersion?: string;
}

/**
 * Builds the plain-text diagnostics report the Setup app exports for support:
 * the detected environment plus runtime details. Pure and deterministic.
 */
export function formatDiagnostics(input: DiagnosticsInput): string {
  const lines: string[] = [
    'AE-MCP diagnostics',
    `Generated: ${(input.now ?? new Date()).toISOString()}`,
    `Platform: ${input.platform ?? platform()} (${input.arch ?? arch()})`,
    `Node: ${input.nodeVersion ?? process.version}`,
    '',
    'After Effects:',
  ];
  if (input.environment.afterEffects.length === 0) {
    lines.push('  (none found)');
  } else {
    for (const install of input.environment.afterEffects) {
      lines.push(`  - ${install.appName} (${install.year}) ${install.path}`);
    }
  }
  const claude = input.environment.claudeDesktop;
  lines.push('Claude Desktop:');
  lines.push(claude === null ? '  (not found)' : `  - ${claude.path}`);
  return `${lines.join('\n')}\n`;
}
