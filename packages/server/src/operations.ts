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
