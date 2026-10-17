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
    // A "$<step>.<path>" reference stands for a value the bridge fills in from an
    // earlier step, so its type is only checked there (#229).
    const withoutRefs = dropBatchReferences(
      definition.schema,
      (sub as { args?: unknown }).args,
      definition.required,
    );
    const validation = validateOperationArgs(definition.schema, withoutRefs.args, withoutRefs.required);
    if (!validation.ok) {
      return makeError('INVALID_ARGS', `ops[${index}] (${name}): ${validation.message}`, validation.details);
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

// Matches "$<step>" plus an optional path, as the bridge resolves it (job-runner.js AEMCP_REF).
const BATCH_REFERENCE = /^\$\d+((\.[A-Za-z_][A-Za-z0-9_]*)|(\[\d+\]))*$/;

/** The args without the schema-known fields that hold a batch reference, and the
required list without those fields. Unknown fields stay, so they still fail. */
function dropBatchReferences(
  schema: Record<string, unknown>,
  args: unknown,
  required: readonly string[] = [],
): { args: unknown; required: string[] } {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { args, required: [...required] };
  }
  const kept: Record<string, unknown> = {};
  const dropped = new Set<string>();
  for (const [key, value] of Object.entries(args)) {
    if (schema[key] !== undefined && typeof value === 'string' && BATCH_REFERENCE.test(value)) {
      dropped.add(key);
    } else {
      kept[key] = value;
    }
  }
  return { args: kept, required: required.filter((name) => !dropped.has(name)) };
}

function subOpName(sub: unknown): string | null {
  return sub !== null &&
    typeof sub === 'object' &&
    typeof (sub as { op?: unknown }).op === 'string'
    ? (sub as { op: string }).op
    : null;
}