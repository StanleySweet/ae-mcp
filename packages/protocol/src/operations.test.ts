import { describe, it, expect } from 'vitest';
import { operationDefinitionSchema } from './operations.js';

const valid = {
  name: 'layer.add_text',
  category: 'layer',
  description: 'Add a text layer.',
  readOnly: false,
  schema: { text: { type: 'string' }, size: { type: 'number' } },
};

describe('operation definition', () => {
  it('parses a valid definition', () => {
    const parsed = operationDefinitionSchema.parse(valid);
    expect(parsed.name).toBe('layer.add_text');
    expect(parsed.category).toBe('layer');
    expect(parsed.readOnly).toBe(false);
    expect(parsed.schema).toEqual({ text: { type: 'string' }, size: { type: 'number' } });
  });

  it('rejects an unknown category', () => {
    expect(() =>
      operationDefinitionSchema.parse({ ...valid, category: 'nope' }),
    ).toThrow();
  });

  it('requires name, category, description and readOnly', () => {
    expect(() => operationDefinitionSchema.parse({ name: 'x' })).toThrow();
  });
});
