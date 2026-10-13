import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'investigate.jsx'),
  'utf8',
);

describe('third-party investigation script', () => {
  it('stays ES3-safe for the After Effects scripting engine', () => {
    expect(script).not.toMatch(/\bconst\b/);
    expect(script).not.toMatch(/\blet\b/);
    expect(script).not.toMatch(/=>/);
    expect(script).not.toContain('`');
  });

  it('collects extensions, preset folders, and the per-layer dump', () => {
    expect(script).toContain('CEP/extensions');
    expect(script).toContain('Presets');
    expect(script).toContain('"Marker"');
    expect(script).toContain('ADBE Effect Parade');
    expect(script).toContain('ADBE Transform Group');
    expect(script).toContain('expressionEnabled');
    expect(script).toContain('ae-mcp-thirdparty-report.txt');
  });
});
