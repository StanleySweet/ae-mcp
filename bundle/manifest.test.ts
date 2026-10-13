import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

describe('mcpb manifest', () => {
  it('has the fields the mcpb spec requires', () => {
    expect(manifest.manifest_version).toMatch(/^\d+\.\d+$/);
    expect(manifest.name).toBeTruthy();
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description).toBeTruthy();
    expect(manifest.author?.name).toBeTruthy();
    expect(manifest.server?.type).toBe('node');
    expect(manifest.server?.entry_point).toMatch(/\.js$/);
  });

  it('runs the server through mcp_config relative to the extension directory', () => {
    expect(manifest.server.mcp_config.command).toBe('node');
    expect(manifest.server.mcp_config.args).toContain('${__dirname}/server/index.js');
  });

  it('ships an icon and targets macOS', () => {
    expect(manifest.icon).toBeTruthy();
    expect(existsSync(join(dir, manifest.icon))).toBe(true);
    expect(manifest.compatibility.platforms).toEqual(['darwin']);
  });

  it('keeps the version in step with package.json', () => {
    const pkg = JSON.parse(readFileSync(join(dir, '..', 'package.json'), 'utf8'));
    expect(manifest.version).toBe(pkg.version);
  });
});
