import type { OperationDefinition } from '@ae-mcp/protocol';

export class OperationRegistry {
  private readonly byName = new Map<string, OperationDefinition>();

  register(definition: OperationDefinition): void {
    this.byName.set(definition.name, definition);
  }

  get(name: string): OperationDefinition | undefined {
    return this.byName.get(name);
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  list(category?: string): OperationDefinition[] {
    const all = [...this.byName.values()];
    const filtered = category ? all.filter((op) => op.category === category) : all;
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }
}

export function defaultOperationRegistry(): OperationRegistry {
  const registry = new OperationRegistry();
  return registry;
}

type PropertySchema = { type?: unknown; enum?: unknown };

const typeChecks: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => typeof value === 'number' && Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  array: (value) => Array.isArray(value),
  object: (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  null: (value) => value === null,
};

/** Validates operation arguments against the operation's JSON-Schema-shaped property map. */
export function validateOperationArgs(
  schema: Record<string, unknown>,
  args: unknown,
): { ok: true; args: Record<string, unknown> } | { ok: false; message: string } {
  if (args === undefined || args === null) {
    return { ok: true, args: {} };
  }
  if (typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, message: 'arguments must be an object' };
  }
  const values = args as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) {
    const property = schema[key] as PropertySchema | undefined;
    if (property === undefined) {
      return { ok: false, message: `unknown argument '${key}'` };
    }
    if (Array.isArray(property.enum) && !property.enum.includes(value)) {
      return {
        ok: false,
        message: `argument '${key}' must be one of ${JSON.stringify(property.enum)}`,
      };
    }
    const check = typeof property.type === 'string' ? typeChecks[property.type] : undefined;
    if (check && !check(value)) {
      return { ok: false, message: `argument '${key}' must be a ${property.type}` };
    }
  }
  return { ok: true, args: values };
}

function levenshtein(a: string, b: string): number {
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[cols - 1]!;
}

/** Names closest to a query by edit distance, nearest first. */
export function closestNames(names: string[], query: string, limit = 3): string[] {
  return names
    .map((name) => ({ name, distance: levenshtein(name, query) }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((entry) => entry.name);
}
