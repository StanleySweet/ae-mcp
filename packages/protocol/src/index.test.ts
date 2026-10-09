import { describe, it, expect } from 'vitest';
import { PROTOCOL_VERSION } from './index.js';

describe('protocol', () => {
  it('has version', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
