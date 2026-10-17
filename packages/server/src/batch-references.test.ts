import { describe, it, expect } from 'vitest';
import { defaultOperationRegistry } from './operations.js';
import { batchRunBlock } from './policy.js';
import { DEFAULT_SETTINGS } from './settings.js';

describe('batch.run references in the server policy check (#229)', () => {
  const registry = defaultOperationRegistry();

  it('accepts a reference in a number field', () => {
    const block = batchRunBlock(
      registry,
      [
        { op: 'layer.add_null', args: { comp: 'Main' } },
        { op: 'layer.rename', args: { comp: 'Main', index: '$0.index', name: 'Renamed' } },
      ],
      DEFAULT_SETTINGS,
    );
    expect(block).toBeNull();
  });

  it('accepts a reference in place of a required index', () => {
    const block = batchRunBlock(
      registry,
      [{ op: 'layer.rename', args: { comp: 'Main', index: '$2.layers[1]', name: 'Renamed' } }],
      DEFAULT_SETTINGS,
    );
    expect(block).toBeNull();
  });

  it('still refuses a plain string in a number field', () => {
    const block = batchRunBlock(
      registry,
      [{ op: 'layer.rename', args: { comp: 'Main', index: 'abc', name: 'Renamed' } }],
      DEFAULT_SETTINGS,
    );
    expect(block?.code).toBe('INVALID_ARGS');
    expect(block?.message).toContain("argument 'index' must be a number");
  });

  it('still refuses a reference under an unknown argument name', () => {
    const block = batchRunBlock(
      registry,
      [{ op: 'layer.rename', args: { comp: 'Main', index: 1, name: 'Renamed', bogus: '$0.index' } }],
      DEFAULT_SETTINGS,
    );
    expect(block?.code).toBe('INVALID_ARGS');
    expect(block?.message).toContain("unknown argument 'bogus'");
  });
});
