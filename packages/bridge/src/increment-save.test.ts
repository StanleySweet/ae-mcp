import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockFile, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-increment-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { value?: unknown; issue?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

describe('project.increment_save', () => {
  it('runs the Increment and Save menu command found by name', async () => {
    const { ctx, ae } = await payloadContext();
    ae.project.file = new MockFile(ae, '/projects/MyProject_v007.aep');

    const outcome = invoke(ctx, 'project.increment_save', null);

    expect(ae.executedCommands).toEqual([ae.menuCommandIds['Increment and Save']]);
    expect(outcome.value).toEqual({ success: true, file: '/projects/MyProject_v008.aep' });
  });

  it('refuses to increment a project that has never been saved', async () => {
    const { ctx, ae } = await payloadContext();
    ae.project.file = null;

    const outcome = invoke(ctx, 'project.increment_save', null);

    expect(ae.executedCommands).toEqual([]);
    expect(outcome.value).toEqual({ success: false, error: 'project has never been saved' });
  });
});
