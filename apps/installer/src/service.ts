import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  detectEnvironment,
  ensureScriptingPref,
  formatDiagnostics,
  handMcpbToClaude,
  repairAeMcp,
  runLiveTest,
  uninstallAeMcp,
  type AEInstall,
  type DetectEnvironmentOptions,
  type IsRunning,
  type LaunchAE,
  type LiveCall,
  type OpenWithClaude,
  type RepairResult,
  type UninstallResult,
} from '@ae-mcp/core';
import { createBridgeCall } from '@ae-mcp/server/bridge';
import type { InstallerApi } from './ipc.js';

export interface InstallerServiceOptions {
  /** Install root (i.e. `~/.ae-mcp`) where the bridge payload is written. */
  root: string;
  /** Bridge payload source (the built `payload.jsx`). */
  payload: string;
  /** Startup loader source (the built `loader.jsx`). */
  loader: string;
  /** Absolute path to the bundled `.mcpb` handed to Claude Desktop. */
  mcpbPath: string;
  environment?: DetectEnvironmentOptions;
  fileName?: string;
  /** AE prefs root; defaults to `aePrefsRoot()`. Injectable for tests. */
  prefsRoot?: string;
  /** AE-running probe; injectable for tests. */
  isRunning?: IsRunning;
  /** Bridge runner for the live test; defaults to the osascript transport. */
  call?: LiveCall;
  /** AE launcher for the live test; defaults to `open -a`. */
  launch?: LaunchAE;
  /** Hands the `.mcpb` to Claude; defaults to `open -a Claude`. */
  openFile?: OpenWithClaude;
}

export type InstallerService = InstallerApi;

/**
 * Builds the installer service: the typed glue between IPC and `packages/core`.
 * Every method is idempotent and safe to call from the renderer.
 */
export function createInstallerService(options: InstallerServiceOptions): InstallerService {
  const resolve = async (install?: AEInstall): Promise<AEInstall | undefined> => {
    if (install) return install;
    const environment = await detectEnvironment(options.environment);
    return environment.afterEffects[0];
  };

  return {
    detect: () => detectEnvironment(options.environment),
    repair: async (install?: AEInstall): Promise<RepairResult> => {
      const environment = await detectEnvironment(options.environment);
      const resolved = install ?? environment.afterEffects[0];
      if (!resolved) {
        return {
          ok: false,
          checks: [
            {
              check: 'after_effects',
              status: 'fail',
              fix: 'Install After Effects, then reopen Setup.',
            },
          ],
        };
      }
      const result = await repairAeMcp({
        root: options.root,
        install: resolved,
        payload: options.payload,
        loader: options.loader,
        fileName: options.fileName,
      });
      const scriptingPref = await ensureScriptingPref({
        appName: resolved.appName,
        prefsRoot: options.prefsRoot,
        isRunning: options.isRunning,
      });
      const extension = await handMcpbToClaude({
        mcpbPath: options.mcpbPath,
        claude: environment.claudeDesktop,
        openFile: options.openFile,
      });
      const checks = [...result.checks, scriptingPref, extension];
      // Only smoke-test the bridge when every install step above passed.
      if (checks.every((check) => check.status === 'ok')) {
        const call =
          options.call ??
          createBridgeCall({ root: options.root, appName: resolved.appName });
        checks.push(
          await runLiveTest({
            root: options.root,
            appName: resolved.appName,
            call,
            launch: options.launch,
          }),
        );
      }
      return { ok: checks.every((check) => check.status === 'ok'), checks };
    },
    uninstall: async (install?: AEInstall): Promise<UninstallResult> => {
      const resolved = await resolve(install);
      if (!resolved) {
        return {
          check: 'uninstall',
          status: 'fail',
          removed: [],
          fix: 'After Effects is not installed; nothing to remove.',
        };
      }
      return uninstallAeMcp({
        root: options.root,
        install: resolved,
        fileName: options.fileName,
      });
    },
    diagnostics: async (): Promise<string> => {
      const environment = await detectEnvironment(options.environment);
      const home = options.environment?.homeDir ?? homedir();
      const target = join(home, 'Desktop', 'ae-mcp-diagnostics.txt');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, formatDiagnostics({ environment }), 'utf8');
      return target;
    },
  };
}
