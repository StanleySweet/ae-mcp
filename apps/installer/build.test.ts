import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { bundleInstaller } from './build.js';

const dir = dirname(fileURLToPath(import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'ae-mcp-installer-'));

afterAll(() => rm(outDir, { recursive: true, force: true }));

describe('installer bundle', () => {
  it('bundles main, preload and renderer with core inlined and electron external', async () => {
    await bundleInstaller(outDir);
    for (const file of ['main.js', 'preload.js', 'renderer.js']) {
      expect(existsSync(join(outDir, file))).toBe(true);
    }
    const main = readFileSync(join(outDir, 'main.js'), 'utf8');
    expect(main).toMatch(/from\s*['"]electron['"]/);
    expect(main).not.toMatch(/from\s*['"]@ae-mcp\/core['"]/);
  }, 60_000);
});

describe('electron-builder config', () => {
  const config = JSON.parse(readFileSync(join(dir, 'electron-builder.json'), 'utf8'));

  it('builds unsigned mac targets for arm64 and x64', () => {
    expect(config.mac.identity).toBeNull();
    const arches = config.mac.target.flatMap((t: { arch: string[] }) => t.arch);
    expect(arches).toContain('arm64');
    expect(arches).toContain('x64');
    const targets = config.mac.target.map((t: { target: string }) => t.target);
    expect(targets).toEqual(expect.arrayContaining(['dmg', 'zip']));
  });

  it('embeds the mcpb from resources as an extra resource', () => {
    expect(config.extraResources).toContainEqual({ from: 'resources', to: '.' });
  });

  it('excludes its own build output from the packaged files', () => {
    expect(config.files).toContain('!dist/mac*/**');
    expect(config.directories.output).toBe('dist');
  });

  it('points the packaged app at the bundled main', () => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.main).toBe('dist/main.js');
  });
});
