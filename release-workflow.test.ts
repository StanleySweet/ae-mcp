import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '.github', 'workflows', 'release.yml'),
  'utf8',
);

describe('release workflow', () => {
  it('runs on version tags and may write a release', () => {
    expect(workflow).toMatch(/tags:\s*\['v\*'\]/);
    expect(workflow).toMatch(/contents:\s*write/);
  });

  it('packs the mcpb, then builds the unsigned installer, then publishes both', () => {
    for (const job of ['mcpb:', 'installer:', 'publish:']) {
      expect(workflow).toContain(job);
    }
    expect(workflow).toContain('path: dist/*.mcpb');
    expect(workflow).toContain('CSC_IDENTITY_AUTO_DISCOVERY');
    expect(workflow).toContain('npm run installer:build -- --mac dmg zip --arm64 --x64');
    expect(workflow).toContain('softprops/action-gh-release@v2');
  });
});
