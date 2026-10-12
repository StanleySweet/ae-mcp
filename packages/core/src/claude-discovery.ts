import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CLAUDE_APP_NAME = 'Claude.app';

export interface ClaudeDesktopInstall {
  /** Display name, always `Claude`. */
  appName: string;
  /** Absolute path to the `.app` bundle. */
  path: string;
  /** Directory holding Claude Desktop's config, e.g. `~/Library/Application Support/Claude`. */
  configDir: string;
  /** Absolute path to `claude_desktop_config.json`. */
  configPath: string;
}

export interface DiscoverClaudeOptions {
  applicationsDir?: string;
  homeDir?: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Directory holding Claude Desktop's config on macOS. */
export function claudeConfigDir(homeDir = homedir()): string {
  return join(homeDir, 'Library', 'Application Support', 'Claude');
}

/**
 * Detects a Claude Desktop install at `applicationsDir` (macOS only). Returns
 * null when `Claude.app` is absent. The config paths are derived from `homeDir`
 * without requiring the config file to exist yet.
 */
export async function discoverClaudeDesktop(
  options: DiscoverClaudeOptions = {},
): Promise<ClaudeDesktopInstall | null> {
  const applicationsDir = options.applicationsDir ?? '/Applications';
  const homeDir = options.homeDir ?? homedir();
  const appPath = join(applicationsDir, CLAUDE_APP_NAME);
  if (!(await pathExists(appPath))) {
    return null;
  }
  const configDir = claudeConfigDir(homeDir);
  return {
    appName: 'Claude',
    path: appPath,
    configDir,
    configPath: join(configDir, 'claude_desktop_config.json'),
  };
}
