import type { ResultMessage } from '@ae-mcp/protocol';

// ae_do `verify: true` (#233): snapshot the comp before a mutating operation and
// diff it afterwards with the bridge's comp.snapshot / comp.diff. The diff lists
// only changed layers and fields; a snapshot or diff failure never fails the
// operation itself, it is reported as `available: false` with the reason.

export type BridgeCall = (tool: string, args: unknown) => Promise<ResultMessage>;

export type VerifyBefore = { snapshot: unknown } | { reason: string };

/** Snapshot the named comp, or the active comp when `comp` is undefined. */
export async function beginVerify(call: BridgeCall, comp: string | undefined): Promise<VerifyBefore> {
  const result = await call('comp.snapshot', comp === undefined ? {} : { comp });
  if (!result.ok) {
    return { reason: result.error.message };
  }
  return { snapshot: result.result };
}

/** The `verify` field of an ae_do result, built after the operation ran. */
export async function finishVerify(
  call: BridgeCall,
  comp: string | undefined,
  before: VerifyBefore,
): Promise<Record<string, unknown>> {
  if (!('snapshot' in before)) {
    return { available: false, reason: before.reason };
  }
  const result = await call('comp.diff', comp === undefined ? { snapshot: before.snapshot } : { comp, snapshot: before.snapshot });
  if (!result.ok) {
    return { available: false, reason: result.error.message };
  }
  return { available: true, ...(result.result as Record<string, unknown>) };
}
