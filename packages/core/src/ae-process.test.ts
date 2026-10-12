import { describe, expect, it } from 'vitest';
import { isAfterEffectsRunning } from './ae-process.js';

describe('isAfterEffectsRunning', () => {
  it('returns false when no matching process is running', async () => {
    expect(await isAfterEffectsRunning('ae-mcp-nonexistent-process-9f3a')).toBe(false);
  });
});
