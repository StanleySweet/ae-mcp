import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { heartbeatSchema } from '@ae-mcp/protocol';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, runInMockAE } from './mock-ae.js';

async function makeAE(): Promise<{ ae: MockAE; home: string; source: string }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const aeHome = join(home, '.ae-mcp');
  const outDir = join(home, 'built');
  await build({ outDir });
  ae.fs.set(
    join(aeHome, 'bridge', 'current.jsx'),
    readFileSync(join(outDir, 'payload.jsx'), 'utf8'),
  );
  return {
    ae,
    home,
    source: readFileSync(join(outDir, 'loader.jsx'), 'utf8'),
  };
}

function heartbeat(ae: MockAE, home: string): unknown {
  const raw = ae.fs.get(join(home, '.ae-mcp', 'bridge', 'outbox', 'heartbeat.json'));
  expect(raw).toBeDefined();
  return JSON.parse(raw as string);
}

describe('bridge loader', () => {
  it('writes a valid heartbeat and loads the payload once', async () => {
    const { ae, home, source } = await makeAE();
    const ctx = runInMockAE(source, ae);
    const beat = heartbeat(ae, home);
    expect(heartbeatSchema.parse(beat)).toMatchObject({
      protocolVersion: 1,
      bridgeVersion: '0.0.0',
      aeVersion: 'MockAE-25',
      os: 'MockAE-OS',
      capabilities: [
        'ae_comp_info',
        'ae_layer_info',
        'ae_project_info',
        'ae_version_info',
        'get_selection',
      ],
      busy: false,
      transport: 'startup-loader',
    });
    expect(vm.runInContext('typeof JSON.parse', ctx)).toBe('function');
  });

  it('reports bridgeVersion "none" when the payload is missing', async () => {
    const { ae, home, source } = await makeAE();
    ae.fs.delete(join(home, '.ae-mcp', 'bridge', 'current.jsx'));
    runInMockAE(source, ae);
    const beat = heartbeat(ae, home);
    expect(heartbeatSchema.parse(beat)).toMatchObject({
      bridgeVersion: 'none',
    });
  });

  it('re-evaluates the payload only when its version changes', async () => {
    const { ae, home, source } = await makeAE();
    const aeHome = join(home, '.ae-mcp', 'bridge');
    runInMockAE(source, ae);
    expect(ae.evalFileCalls).toBe(1);
    expect(ae.fs.get(join(aeHome, '.payload-version'))).toBe('0.0.0');

    ae.fs.set(
      join(aeHome, 'current.jsx'),
      'var AEMCP_BRIDGE_VERSION = "9.9.9"; var PAYLOAD_RELOADED = 1;',
    );
    runInMockAE(source, ae);
    expect(ae.evalFileCalls).toBe(2);
    expect(ae.fs.get(join(aeHome, '.payload-version'))).toBe('9.9.9');

    runInMockAE(source, ae);
    expect(ae.evalFileCalls).toBe(2);
  });
});