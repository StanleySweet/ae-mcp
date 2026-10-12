import type {
  AEInstall,
  DetectedEnvironment,
  RepairResult,
  UninstallResult,
} from '@ae-mcp/core';

/** IPC channel names shared by the main process and the preload bridge. */
export const IPC_CHANNELS = {
  detect: 'installer:detect',
  repair: 'installer:repair',
  uninstall: 'installer:uninstall',
  diagnostics: 'installer:diagnostics',
} as const;

/** Names exposed on `window.installer` by the preload script. */
export interface InstallerApi {
  /** Detects After Effects installs and Claude Desktop. */
  detect(): Promise<DetectedEnvironment>;
  /** Runs every install/repair step for the given (or newest detected) AE. */
  repair(install?: AEInstall): Promise<RepairResult>;
  /** Removes the bridge payload, folders and Startup loader. */
  uninstall(install?: AEInstall): Promise<UninstallResult>;
  /** Writes a diagnostics report and returns its path. */
  diagnostics(): Promise<string>;
}
