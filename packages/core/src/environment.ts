import { discoverAEVersions, type AEInstall } from './ae-discovery.js';
import { discoverClaudeDesktop, type ClaudeDesktopInstall } from './claude-discovery.js';

export interface DetectedEnvironment {
  afterEffects: AEInstall[];
  claudeDesktop: ClaudeDesktopInstall | null;
}

export interface DetectEnvironmentOptions {
  applicationsDir?: string;
  homeDir?: string;
}

/**
 * Detects the macOS machine's After Effects installs and Claude Desktop install
 * in one call, for the Setup app's checklist.
 */
export async function detectEnvironment(
  options: DetectEnvironmentOptions = {},
): Promise<DetectedEnvironment> {
  const [afterEffects, claudeDesktop] = await Promise.all([
    discoverAEVersions(options.applicationsDir),
    discoverClaudeDesktop(options),
  ]);
  return { afterEffects, claudeDesktop };
}
