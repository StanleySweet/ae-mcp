export { MIN_SUPPORTED_AE_YEAR, discoverAEVersions } from './ae-discovery.js';
export type { AEInstall } from './ae-discovery.js';
export {
  CLAUDE_APP_NAME,
  claudeConfigDir,
  discoverClaudeDesktop,
} from './claude-discovery.js';
export type { ClaudeDesktopInstall, DiscoverClaudeOptions } from './claude-discovery.js';
export { detectEnvironment } from './environment.js';
export type { DetectEnvironmentOptions, DetectedEnvironment } from './environment.js';
export { installPayload, payloadVersion } from './install-payload.js';
export type {
  InstallPayloadOptions,
  InstallPayloadResult,
  InstallStatus,
  InstallerCheck,
} from './install-payload.js';
export {
  LOADER_FILE_NAME,
  elevatedCopyCommand,
  installLoader,
  loaderStartupDir,
  osascriptElevatedWrite,
} from './install-loader.js';
export type {
  ElevatedWrite,
  InstallLoaderOptions,
  InstallLoaderResult,
} from './install-loader.js';
export {
  MAIN_PREF_SECTION,
  SCRIPTING_PREF_KEY,
  aePrefsRoot,
  discoverPrefsDirs,
  enableScriptingPref,
  ensureScriptingPref,
  findPrefsFile,
  readScriptingPref,
  setScriptingPref,
} from './scripting-pref.js';
export type {
  AEPrefsDir,
  EnableScriptingPrefOptions,
  EnableScriptingPrefResult,
  EnsureScriptingPrefOptions,
  ScriptingPrefEdit,
} from './scripting-pref.js';
export { isAfterEffectsRunning } from './ae-process.js';
export type { IsRunning } from './ae-process.js';
export { claudeOpenArgs, handMcpbToClaude, openWithClaude } from './install-mcpb.js';
export type { HandMcpbOptions, HandMcpbResult, OpenWithClaude } from './install-mcpb.js';
export { TEST_COMP_NAME, isHeartbeatFresh, runLiveTest } from './live-test.js';
export type { LaunchAE, LiveCall, LiveTestOptions } from './live-test.js';
export { repairAeMcp, uninstallAeMcp } from './repair-uninstall.js';
export type {
  RepairOptions,
  RepairResult,
  UninstallOptions,
  UninstallResult,
} from './repair-uninstall.js';
export { discoverAerender, discoverAerenders } from './aerender-discovery.js';
export type { AerenderInstall } from './aerender-discovery.js';
export { parseAerenderLine } from './aerender-progress.js';
export type { AerenderEvent } from './aerender-progress.js';
export { buildAerenderArgs, runAerender } from './aerender-runner.js';
export type {
  AerenderClose,
  AerenderProcess,
  AerenderResult,
  AerenderRunHandle,
  AerenderRunOptions,
  AerenderStream,
  AerenderVerbose,
  SpawnAerender,
} from './aerender-runner.js';
