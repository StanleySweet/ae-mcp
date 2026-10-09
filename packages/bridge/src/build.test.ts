import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';

async function withOutDir(fn: (outDir: string) => Promise<void>): Promise<void> {
  const outDir = await mkdtemp(join(tmpdir(), 'ae-mcp-build-'));
  try {
    await fn(outDir);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

describe('bridge build', () => {
  it('writes loader.jsx and payload.jsx into the out dir', async () => {
    await withOutDir(async (outDir) => {
      await build({ outDir });
      const loader = await readFile(join(outDir, 'loader.jsx'), 'utf8');
      const payload = await readFile(join(outDir, 'payload.jsx'), 'utf8');
      expect(loader.length).toBeGreaterThan(0);
      expect(payload.length).toBeGreaterThan(0);
    });
  });

  it('stamps the built files with the bridge version', async () => {
    await withOutDir(async (outDir) => {
      await build({ outDir });
      const loader = await readFile(join(outDir, 'loader.jsx'), 'utf8');
      expect(loader).toContain('AEMCP_BRIDGE_VERSION = "0.0.0"');
    });
  });

  it('concatenates polyfills then json2 into the payload, in order', async () => {
    await withOutDir(async (outDir) => {
      await build({ outDir });
      const payload = await readFile(join(outDir, 'payload.jsx'), 'utf8');
      const polyfillAt = payload.indexOf('if (!ap.forEach)');
      const jsonAt = payload.indexOf('json2.js');
      expect(polyfillAt).toBeGreaterThan(-1);
      expect(jsonAt).toBeGreaterThan(polyfillAt);
    });
  });
});