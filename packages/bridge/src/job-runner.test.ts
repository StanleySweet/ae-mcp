import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  contractCases,
  type BridgeDriver,
  type JobMessage,
  type ResultMessage,
} from '@ae-mcp/protocol';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, runInMockAE } from './mock-ae.js';

class VmBridgeDriver implements BridgeDriver {
  constructor(
    private readonly ctx: vm.Context,
    private readonly ae: MockAE,
    readonly root: string,
  ) {}

  async sendJob(job: JobMessage): Promise<void> {
    this.ae.fs.set(join(this.root, 'bridge', 'inbox', `${job.id}.json`), JSON.stringify(job));
  }

  async sendRaw(name: string, content: string): Promise<void> {
    this.ae.fs.set(join(this.root, 'bridge', 'inbox', name), content);
  }

  async waitForResult(id: string): Promise<ResultMessage> {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      vm.runInContext(`AEMCP.poll("${this.root}")`, this.ctx);
      const raw = this.ae.fs.get(join(this.root, 'bridge', 'outbox', `${id}.json`));
      if (raw !== undefined) {
        return JSON.parse(raw) as ResultMessage;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`no result for ${id}`);
  }
}

async function setup(): Promise<{ driver: VmBridgeDriver; ae: MockAE; ctx: vm.Context }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-jobs-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const root = join(home, '.ae-mcp');
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  vm.runInContext('AEMCP.HANDLERS.echo = function (args) { return args; };', ctx);
  return {
    driver: new VmBridgeDriver(ctx, ae, root),
    ae,
    ctx,
  };
}

describe('bridge job runner', () => {
  it('passes the protocol contract suite', async () => {
    const { driver } = await setup();
    for (const c of contractCases('echo')) {
      await c.run(driver);
    }
  });

  it('runs each job inside one undo group and writes an error result on throw', async () => {
    const { driver, ae, ctx } = await setup();
    vm.runInContext(
      'AEMCP.HANDLERS.boom = function () { throw new Error("kaboom"); };',
      ctx,
    );
    await driver.sendJob({
      protocolVersion: 1,
      id: 'u-1',
      tool: 'boom',
      args: {},
      deadline: Date.now() + 5000,
    });
    const result = await driver.waitForResult('u-1');
    expect(ae.app.inUndoGroup()).toBe(false);
    expect(ae.undoGroups).toHaveLength(1);
    expect(ae.undoGroups[0].name).toBe('Claude: boom');
    expect(ae.undoGroups[0].end).toBeGreaterThanOrEqual(ae.undoGroups[0].start);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'SCRIPT_ERROR',
        message: 'Error: kaboom',
      },
    });
  });

  it('consumes the job file after writing the result', async () => {
    const { driver, ae, ctx } = await setup();
    const root = driver.root;
    await driver.sendJob({
      protocolVersion: 1,
      id: 'consume-1',
      tool: 'echo',
      args: { ping: true },
      deadline: Date.now() + 5000,
    });
    const result = await driver.waitForResult('consume-1');
    expect(result.ok).toBe(true);
    expect(
      ae.fs.has(join(root, 'bridge', 'inbox', 'consume-1.json')),
    ).toBe(false);
    expect(
      ae.fs.has(join(root, 'bridge', 'outbox', 'consume-1.json')),
    ).toBe(true);
    expect(vm.runInContext('typeof AEMCP.processJob', ctx)).toBe('function');
  });

  it('processes at most one job per poll tick and stays busy while jobs remain', async () => {
    const { driver, ae, ctx } = await setup();
    const root = driver.root;
    await driver.sendJob({
      protocolVersion: 1,
      id: 'chunk-1',
      tool: 'echo',
      args: { n: 1 },
      deadline: Date.now() + 5000,
    });
    await driver.sendJob({
      protocolVersion: 1,
      id: 'chunk-2',
      tool: 'echo',
      args: { n: 2 },
      deadline: Date.now() + 5000,
    });
    expect(vm.runInContext('AEMCP.busy()', ctx)).toBe(false);
    vm.runInContext(`AEMCP.poll("${root}")`, ctx);
    expect(ae.fs.has(join(root, 'bridge', 'outbox', 'chunk-1.json'))).toBe(true);
    expect(ae.fs.has(join(root, 'bridge', 'outbox', 'chunk-2.json'))).toBe(false);
    expect(vm.runInContext('AEMCP.busy()', ctx)).toBe(true);

    vm.runInContext(`AEMCP.poll("${root}")`, ctx);
    expect(ae.fs.has(join(root, 'bridge', 'outbox', 'chunk-2.json'))).toBe(true);
    expect(vm.runInContext('AEMCP.busy()', ctx)).toBe(false);
  });
});

describe('bridge batch.run', () => {
  it('runs every sub-op inside a single batch.run undo group', async () => {
    const { driver, ae, ctx } = await setup();
    vm.runInContext(
      'AEMCP.HANDLERS["a.one"] = function (args) { return args.n; };' +
        'AEMCP.HANDLERS["a.two"] = function (args) { return args.n * 2; };',
      ctx,
    );
    await driver.sendJob({
      protocolVersion: 1,
      id: 'batch-ok',
      tool: 'batch.run',
      args: { ops: [{ op: 'a.one', args: { n: 1 } }, { op: 'a.two', args: { n: 2 } }] },
      deadline: Date.now() + 5000,
    });
    const result = await driver.waitForResult('batch-ok');
    expect(result).toEqual({
      protocolVersion: 1,
      ok: true,
      result: { results: [1, 4] },
    });
    expect(ae.undoGroups).toHaveLength(1);
    expect(ae.undoGroups[0]!.name).toBe('Claude: batch.run');
    expect(ae.app.inUndoGroup()).toBe(false);
  });

  it('stops at the first failing sub-op and keeps the single undo group', async () => {
    const { driver, ae, ctx } = await setup();
    vm.runInContext(
      'var ran = [];' +
        'AEMCP.HANDLERS["a.ok"] = function () { ran.push("ok"); return 1; };' +
        'AEMCP.HANDLERS["a.boom"] = function () { throw new Error("kaboom"); };' +
        'AEMCP.HANDLERS["a.after"] = function () { ran.push("after"); return 9; };',
      ctx,
    );
    await driver.sendJob({
      protocolVersion: 1,
      id: 'batch-boom',
      tool: 'batch.run',
      args: { ops: [{ op: 'a.ok' }, { op: 'a.boom' }, { op: 'a.after' }] },
      deadline: Date.now() + 5000,
    });
    const result = await driver.waitForResult('batch-boom');
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SCRIPT_ERROR', message: 'Error: kaboom' },
    });
    expect(vm.runInContext('ran.join(",")', ctx)).toBe('ok');
    expect(ae.undoGroups).toHaveLength(1);
  });

  it('reports an unknown sub-op with UNKNOWN_TOOL', async () => {
    const { driver } = await setup();
    await driver.sendJob({
      protocolVersion: 1,
      id: 'batch-unknown',
      tool: 'batch.run',
      args: { ops: [{ op: 'nope.nope' }] },
      deadline: Date.now() + 5000,
    });
    const result = await driver.waitForResult('batch-unknown');
    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TOOL' } });
  });

  it('rejects a sub-op without a name with INVALID_ARGS', async () => {
    const { driver } = await setup();
    await driver.sendJob({
      protocolVersion: 1,
      id: 'batch-invalid',
      tool: 'batch.run',
      args: { ops: [{ args: {} }] },
      deadline: Date.now() + 5000,
    });
    const result = await driver.waitForResult('batch-invalid');
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
  });
});