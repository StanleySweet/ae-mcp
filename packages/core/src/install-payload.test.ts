import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { installPayload, payloadVersion } from './install-payload.js';

describe('payloadVersion', () => {
  it('reads the version from the build stamp', () => {
    expect(payloadVersion('var AEMCP_BRIDGE_VERSION = "1.2.3";')).toBe('1.2.3');
  });

  it('returns null when the stamp is missing', () => {
    expect(payloadVersion('var x = 1;')).toBeNull();
  });
});

describe('installPayload', () => {
  it('writes the payload and creates the bridge folders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-root-'));
    const payload = 'var AEMCP_BRIDGE_VERSION = "1.2.3";\n';

    const result = await installPayload({ root, payload });

    expect(result).toMatchObject({ check: 'bridge_payload', status: 'ok', version: '1.2.3', changed: true });
    expect(await readFile(join(root, 'bridge', 'current.jsx'), 'utf8')).toBe(payload);
    expect((await readdir(join(root, 'bridge'))).sort()).toContain('inbox');
    expect((await readdir(join(root, 'bridge'))).sort()).toContain('outbox');
  });

  it('is idempotent: a second run with the same payload changes nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const payload = 'var AEMCP_BRIDGE_VERSION = "1.0.0";';

    await installPayload({ root, payload });
    const second = await installPayload({ root, payload });

    expect(second).toMatchObject({ status: 'ok', version: '1.0.0', changed: false });
  });

  it('rewrites when the payload version changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));

    await installPayload({ root, payload: 'var AEMCP_BRIDGE_VERSION = "1.0.0";' });
    const second = await installPayload({
      root,
      payload: 'var AEMCP_BRIDGE_VERSION = "2.0.0";',
    });

    expect(second).toMatchObject({ status: 'ok', version: '2.0.0', changed: true });
    expect(await readFile(join(root, 'bridge', 'current.jsx'), 'utf8')).toContain('2.0.0');
  });

  it('fails with a fix when the payload carries no version stamp', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));

    const result = await installPayload({ root, payload: '// no stamp here' });

    expect(result.status).toBe('fail');
    expect(result.fix).toBeTruthy();
  });

  it('fails with a fix when the target cannot be created', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const root = join(parent, 'not-a-dir');
    await writeFile(root, 'file in the way');

    const result = await installPayload({ root, payload: 'var AEMCP_BRIDGE_VERSION = "1.0.0";' });

    expect(result.status).toBe('fail');
    expect(result.fix).toBeTruthy();
  });
});

describe('installPayload overwrite of an existing install', () => {
  it('replaces a previously installed payload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    await mkdir(join(root, 'bridge'), { recursive: true });
    await writeFile(join(root, 'bridge', 'current.jsx'), 'var AEMCP_BRIDGE_VERSION = "0.0.1";');

    const result = await installPayload({ root, payload: 'var AEMCP_BRIDGE_VERSION = "2.0.0";' });

    expect(result.changed).toBe(true);
    expect(await readFile(join(root, 'bridge', 'current.jsx'), 'utf8')).toContain('2.0.0');
  });
});
