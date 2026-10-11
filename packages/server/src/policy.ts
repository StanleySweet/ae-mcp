import { makeError, type OperationDefinition } from '@ae-mcp/protocol';
import type { OperationRegistry } from './operations.js';
import type { Settings } from './settings.js';

export function isPermitted(definition: OperationDefinition, settings: Settings): boolean {
  if (settings.readOnly && !definition.readOnly) {
    return false;
  }
  if (
    settings.allowedCategories !== null &&
    !settings.allowedCategories.includes(definition.category)
  ) {
    return false;
  }
  return true;
}

/** eval.run exists only when eval is explicitly enabled. */
export function evalRunEnabled(definition: OperationDefinition, settings: Settings): boolean {
  return definition.name !== 'eval.run' || settings.evalEnabled;
}

/** The first policy-blocked sub-op of a batch.run, or null when none blocks it. */
export function batchRunBlock(
  registry: OperationRegistry,
  ops: unknown,
  settings: Settings,
): ReturnType<typeof makeError> | null {
  if (!Array.isArray(ops)) {
    return null;
  }
  for (const sub of ops) {
    const name = subOpName(sub);
    if (name === null) {
      continue;
    }
    const definition = registry.get(name);
    if (definition === undefined) {
      return makeError('UNKNOWN_TOOL', `unknown operation '${name}' inside batch.run`);
    }
    if (!isPermitted(definition, settings)) {
      return makeError(
        'FORBIDDEN',
        `operation '${name}' inside batch.run is not permitted by the current policy`,
      );
    }
  }
  return null;
}

/** Whether any batch.run sub-operation is destructive and so needs the guard. */
export function batchHasDestructive(registry: OperationRegistry, ops: unknown): boolean {
  if (!Array.isArray(ops)) {
    return false;
  }
  for (const sub of ops) {
    const name = subOpName(sub);
    if (name !== null) {
      const definition = registry.get(name);
      if (definition?.destructive) {
        return true;
      }
    }
  }
  return false;
}

function subOpName(sub: unknown): string | null {
  return sub !== null &&
    typeof sub === 'object' &&
    typeof (sub as { op?: unknown }).op === 'string'
    ? (sub as { op: string }).op
    : null;
}