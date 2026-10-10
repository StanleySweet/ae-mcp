import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { heartbeatSchema } from '@ae-mcp/protocol';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, runInMockAE } from './mock-ae.js';

const CORE_TOOLS = [
  'ae_comp_info',
  'ae_layer_info',
  'ae_project_info',
  'ae_version_info',
  'batch.run',
  'find',
  'get_selection',
  'project.info',
  'project.undo',
];

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-registry-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

async function loaderWithPayload(): Promise<{ ctx: vm.Context; ae: MockAE; home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-registry-loader-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const aeHome = join(home, '.ae-mcp');
  const outDir = join(home, 'built');
  await build({ outDir });
  ae.fs.set(
    join(aeHome, 'bridge', 'current.jsx'),
    readFileSync(join(outDir, 'payload.jsx'), 'utf8'),
  );
  const ctx = runInMockAE(readFileSync(join(outDir, 'loader.jsx'), 'utf8'), ae);
  return { ctx, ae, home };
}

describe('handler registry', () => {
  it('lists registered tools alphabetically', async () => {
    const { ctx } = await payloadContext();
    const builtIn = vm.runInContext('AEMCP.capabilities()', ctx) as string[];
    expect(builtIn).toEqual(expect.arrayContaining(CORE_TOOLS));
    vm.runInContext(
      'AEMCP.register("z.one", function () { return 1; });' +
        'AEMCP.register("a.two", function () { return 2; });',
      ctx,
    );
    expect(vm.runInContext('AEMCP.capabilities()', ctx)).toEqual(
      [...builtIn, 'a.two', 'z.one'].sort(),
    );
    expect(vm.runInContext('typeof AEMCP.invoke("a.two", null, 9999999999999)', ctx)).toBe(
      'object',
    );
  });

  it('rejects duplicate or invalid registrations', async () => {
    const { ctx } = await payloadContext();
    vm.runInContext('AEMCP.register("dup", function () { return 1; });', ctx);
    expect(() =>
      vm.runInContext('AEMCP.register("dup", function () { return 2; });', ctx),
    ).toThrow(/already registered/);
    expect(() => vm.runInContext('AEMCP.register("x", 42);', ctx)).toThrow(
      /must be a function/,
    );
  });

  it('reports registered tools in the heartbeat capabilities', async () => {
    const { ctx, ae, home } = await loaderWithPayload();
    const beatPath = join(home, '.ae-mcp', 'bridge', 'outbox', 'heartbeat.json');
    const first = JSON.parse(ae.fs.get(beatPath) as string);
    expect(heartbeatSchema.parse(first)).toMatchObject({
      transport: 'startup-loader',
      capabilities: expect.arrayContaining(CORE_TOOLS),
    });
    expect(first.capabilities).toEqual([...first.capabilities].sort());

    vm.runInContext(
      'AEMCP.register("comp.add", function () { return true; });',
      ctx,
    );
    ae.advance(30000);
    const second = JSON.parse(ae.fs.get(beatPath) as string);
    expect(heartbeatSchema.parse(second)).toMatchObject({
      capabilities: [...first.capabilities, 'comp.add'].sort(),
      busy: false,
    });
  });

  it('reports busy while jobs are still draining', async () => {
    const { ctx, ae, home } = await loaderWithPayload();
    const beatPath = join(home, '.ae-mcp', 'bridge', 'outbox', 'heartbeat.json');
    for (let i = 0; i < 160; i += 1) {
      ae.fs.set(
        join(home, '.ae-mcp', 'bridge', 'inbox', `busy-${i}.json`),
        JSON.stringify({
          protocolVersion: 1,
          id: `busy-${i}`,
          tool: 'echo',
          args: {},
          deadline: Date.now() + 60_000,
        }),
      );
    }
    vm.runInContext('AEMCP.register("echo", function () { return 1; });', ctx);
    ae.advance(30_000);
    const midDrain = JSON.parse(ae.fs.get(beatPath) as string);
    expect(heartbeatSchema.parse(midDrain)).toMatchObject({ busy: true });

    ae.advance(40_000);
    const drained = JSON.parse(ae.fs.get(beatPath) as string);
    expect(heartbeatSchema.parse(drained)).toMatchObject({ busy: false });
  });
});