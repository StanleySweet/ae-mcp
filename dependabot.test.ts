import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const config = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '.github', 'dependabot.yml'),
  'utf8',
);

describe('dependabot config', () => {
  it('checks npm and github-actions weekly, with grouped updates', () => {
    expect(config).toMatch(/^version:\s*2$/m);
    expect(config).toContain('package-ecosystem: npm');
    expect(config).toContain('package-ecosystem: github-actions');
    expect(config.match(/interval: weekly/g)).toHaveLength(2);
    expect(config.match(/groups:/g)).toHaveLength(2);
  });
});
