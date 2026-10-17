import { describe, expect, it } from 'vitest';
import { runSmoke } from './smoke.js';

describe('bundle:smoke', () => {
  it('starts the packed server against the fake bridge and lists its tools', async () => {
    const { toolNames, instructions } = await runSmoke();
    expect(toolNames).toContain('check_setup');
    expect(toolNames).toContain('ae_catalog');
    expect(toolNames).toContain('ae_do');
    expect(instructions).toContain('ae-mcp://animation-principles');
  }, 60_000);
});
