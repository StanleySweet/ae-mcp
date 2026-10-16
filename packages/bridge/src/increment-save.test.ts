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
  it('saves to the next versioned filename without prompting', async () => {
    const { ctx, ae } = await payloadContext();
    ae.project.file = new MockFile(ae, '/projects/MyProject_v007.aep');

    const outcome = invoke(ctx, 'project.increment_save', null);

    expect(ae.executedCommands).toEqual([]);
    expect(outcome.value).toEqual({ success: true, file: '/projects/MyProject_v008.aep' });
  });

  it('starts at _v001 when the project has no version suffix', async () => {
    const { ctx, ae } = await payloadContext();
    ae.project.file = new MockFile(ae, '/projects/MyProject.aep');

    const outcome = invoke(ctx, 'project.increment_save', null);

    expect(outcome.value).toEqual({ success: true, file: '/projects/MyProject_v001.aep' });
  });

  it('refuses to increment a project that has never been saved', async () => {
    const { ctx, ae } = await payloadContext();
    ae.project.file = null;

    const outcome = invoke(ctx, 'project.increment_save', null);

    expect(ae.executedCommands).toEqual([]);
    expect(outcome.issue).toMatchObject({ code: 'UNSAVED_PROJECT', message: 'project has never been saved' });
  });
});
