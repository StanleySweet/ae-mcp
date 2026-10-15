import { createAEClient } from './ae-client.js';
import { OsaScriptTransport, aeAppName } from './osascript-transport.js';

export { createAEClient } from './ae-client.js';
export type { AEClient, AEClientOptions } from './ae-client.js';
export { OsaScriptTransport, selectTransport, aeAppName } from './osascript-transport.js';
export type { Transport } from './transport.js';

/** Runs one bridge operation and reports whether it succeeded. */
export type LiveCall = (tool: string, args: Record<string, unknown>) => Promise<boolean>;

export interface BridgeCallOptions {
  /** Queue root, usually `~/.ae-mcp`. */
  root: string;
  /** After Effects app name; defaults to `AE_APP_NAME` (ADR 0001 transport B). */
  appName?: string;
}

/**
 * A {@link LiveCall} that runs one bridge operation through the osascript
 * transport (transport B, ADR 0001). Used by the Setup app's live test.
 */
export function createBridgeCall(options: BridgeCallOptions): LiveCall {
  const client = createAEClient({
    transport: new OsaScriptTransport(options.root, options.appName ?? aeAppName()),
    root: options.root,
  });
  return async (tool, args) => (await client.call(tool, args)).ok;
}
