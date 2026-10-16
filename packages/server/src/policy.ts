import { makeError, type OperationDefinition } from '@ae-mcp/protocol';
import { validateOperationArgs, type OperationRegistry } from './operations.js';
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

/** The first sub-op of a batch.run that ae_do would refuse on its own (unknown,
bad arguments, outside the policy, or eval.run while eval is off), or null.
Each step gets the same checks as a standalone ae_do call (#182). */
export function batchRunBlock(
  registry: OperationRegistry,
  ops: unknown,
  settings: Settings,
): ReturnType<typeof makeError> | null {
  if (!Array.isArray(ops)) {
    return null;
  }
  for (const [index, sub] of ops.entries()) {
    const name = subOpName(sub);
    if (name === null) {
      return makeError('INVALID_ARGS', `ops[${index}].op must be a non-empty string`);
    }
    const definition = registry.get(name);
    if (definition === undefined) {
      return makeError('UNKNOWN_TOOL', `unknown operation '${name}' inside batch.run`);
    }
    const validation = validateOperationArgs(definition.schema, (sub as { args?: unknown }).args);
    if (!validation.ok) {
      return makeError('INVALID_ARGS', `ops[${index}] (${name}): ${validation.message}`);
    }
    if (!isPermitted(definition, settings) || !evalRunEnabled(definition, settings)) {
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