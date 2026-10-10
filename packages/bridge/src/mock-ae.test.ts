import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, runInMockAE } from './mock-ae.js';

async function builtPayload(): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), 'ae-mcp-payload-'));
  try {
    await build({ outDir });
    return await readFile(join(outDir, 'payload.jsx'), 'utf8');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

describe('mock AE', () => {
  it('records undo groups with virtual timestamps', () => {
    const ae = new MockAE();
    ae.app.beginUndoGroup('job-1');
    ae.advance(10);
    ae.app.endUndoGroup();
    expect(ae.undoGroups).toEqual([
      { name: 'job-1', start: 0, end: 10 },
    ]);
    expect(ae.app.inUndoGroup()).toBe(false);
  });

  it('throws on endUndoGroup without beginUndoGroup', () => {
    const ae = new MockAE();
    expect(() => ae.app.endUndoGroup()).toThrow(/beginUndoGroup/);
  });

  it('runs scheduled code strings when virtual time passes, rescheduling repeats', () => {
    const ae = new MockAE();
    const sandbox = runInMockAE(
      'var hits = []; app.scheduleTask("hits.push($.hiresTimer())", 100, true);',
      ae,
    );
    ae.advance(120);
    ae.advance(90);
    expect(vm.runInContext('hits', sandbox)).toEqual([100, 200]);
    expect(ae.now()).toBe(210);
  });

  it('rejects non-string scheduleTask arguments like real After Effects', () => {
    const ae = new MockAE();
    runInMockAE('', ae);
    expect(() =>
      ae.app.scheduleTask((() => undefined) as unknown as string, 100, true),
    ).toThrow(/string/);
  });

  it('reports virtual time through $.hiresTimer', () => {
    const ae = new MockAE();
    ae.advance(42);
    expect(ae.$.hiresTimer()).toBe(42);
  });
});

describe('vm test harness', () => {
  it('runs the built payload against a mock AE sandbox', async () => {
    const ae = new MockAE();
    const sandbox = runInMockAE(await builtPayload(), ae);
    expect(vm.runInContext('AEMCP_BRIDGE_VERSION', sandbox)).toBe('0.0.0');
    expect(
      vm.runInContext('typeof Array.prototype.forEach', sandbox),
    ).toBe('function');
    expect(vm.runInContext('typeof JSON.parse', sandbox)).toBe('function');
    expect(vm.runInContext('JSON.parse("{\\"n\\":1}").n', sandbox)).toBe(1);
    const items = ['a', 'b'];
    expect(vm.runInContext('Array.prototype.map', sandbox)).toBeDefined();
    expect(
      Array.prototype.map.call(items, (c: string) => c.toUpperCase()),
    ).toEqual(['A', 'B']);
  });
});