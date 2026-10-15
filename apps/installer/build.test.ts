import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { bundleInstaller } from './build.js';

const dir = dirname(fileURLToPath(import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'ae-mcp-installer-'));
const sourcesDir = mkdtempSync(join(tmpdir(), 'ae-mcp-bridge-src-'));
const PAYLOAD = 'var AEMCP_BRIDGE_VERSION = "1.2.3";';
const LOADER = 'var AEMCP_LOADER = true;';
writeFileSync(join(sourcesDir, 'payload.jsx'), PAYLOAD);
writeFileSync(join(sourcesDir, 'loader.jsx'), LOADER);

afterAll(() => rm(outDir, { recursive: true, force: true }));
afterAll(() => rm(sourcesDir, { recursive: true, force: true }));

describe('installer bundle', () => {
  it('bundles main, preload and renderer with core inlined and electron external', async () => {
    await bundleInstaller(outDir, sourcesDir);
    for (const file of ['main.js', 'preload.js', 'renderer.js']) {
      expect(existsSync(join(outDir, file))).toBe(true);
    }
    const main = readFileSync(join(outDir, 'main.js'), 'utf8');
    expect(main).toMatch(/from\s*['"]electron['"]/);
    expect(main).not.toMatch(/from\s*['"]@ae-mcp\/core['"]/);
    expect(main).not.toMatch(/from\s*['"]@ae-mcp\/server/);
  }, 60_000);

  it('copies the bridge payload and loader next to the bundle', async () => {
    await bundleInstaller(outDir, sourcesDir);
    expect(readFileSync(join(outDir, 'payload.jsx'), 'utf8')).toBe(PAYLOAD);
    expect(readFileSync(join(outDir, 'loader.jsx'), 'utf8')).toBe(LOADER);
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

  it('lays out the dmg with the app and an Applications drop target', () => {
    const contents = config.dmg.contents;
    expect(contents).toContainEqual({ x: 400, y: 190, type: 'link', path: '/Applications' });
    expect(contents.some((e: { path?: string }) => e.path === undefined)).toBe(true);
  });

  it('ships a custom app icon', () => {
    expect(existsSync(join(dir, 'build', 'icon.icns'))).toBe(true);
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
