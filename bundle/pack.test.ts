import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { packBundle } from './pack.js';

const outDir = mkdtempSync(join(tmpdir(), 'ae-mcp-bundle-'));

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe('bundle:pack', () => {
  it('produces a .mcpb holding the manifest, the icon and a bundled server', async () => {
    const artifact = await packBundle(outDir);
    expect(existsSync(artifact)).toBe(true);

    const entries = execFileSync('unzip', ['-Z1', artifact]).toString().split('\n');
    expect(entries).toContain('manifest.json');
    expect(entries).toContain('icon.png');
    expect(entries).toContain('server/index.js');
  }, 60_000);
});
