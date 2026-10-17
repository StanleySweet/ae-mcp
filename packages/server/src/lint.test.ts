import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { AEClient } from './ae-client.js';
import { defaultOperationRegistry } from './operations.js';
import { createServer } from './server.js';

const report = {
  findings: [
    {
      item: 'Main / tmp layer',
      rule: 'naming',
      severity: 'warning',
      message: 'name does not match ^[A-Z]',
      comp: 'Main',
      layer: 2,
      fix: {
        safe: true,
        description: 'rename with naming.fix',
        op: 'bulk.rename',
        args: { comp: 'Main', layers: [2], match: 'tmp', replace: 'Tmp', regex: false, flags: '' },
      },
    },
    {
      item: 'gone.mov',
      rule: 'missing-footage',
      severity: 'error',
      message: 'source file not found',
      fix: { safe: false, description: 'relink or replace the footage (left for you)' },
    },
  ],
  counts: { total: 2, safeFixes: 1 },
};

async function connect(calls: Array<{ tool: string; args: Record<string, unknown> }>) {
  const root = await mkdtemp(join(tmpdir(), 'ae-mcp-lint-server-'));
  const client = {
    call: async (tool: string, args: Record<string, unknown>) => {
      calls.push({ tool, args });
      if (tool === 'project.lint') return { ok: true as const, result: report };
      if (tool === 'bulk.rename') {
        return args.dryRun === false
          ? { ok: true as const, result: { dryRun: false, applied: 1, changes: [] } }
          : { ok: true as const, result: { dryRun: true, changes: [{ index: 2, from: 'tmp', to: 'Tmp' }], fingerprint: 'fp1' } };
      }
      return { ok: true as const, result: null };
    },
  } as unknown as AEClient;
  const server = createServer({ root, client, operations: defaultOperationRegistry() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: 'lint-test', version: '0.0.0' });
  await mcp.connect(clientTransport);
  return { mcp, close: () => mcp.close() };
}

function parse(result: object): Record<string, unknown> {
  const [first] = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(first!.text) as Record<string, unknown>;
}

describe('project.lint through ae_do', () => {
  it('reports without fixing when fix is not set', async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const { mcp, close } = await connect(calls);
    try {
      const result = await mcp.callTool({ name: 'ae_do', arguments: { op: 'project.lint', args: { naming: { pattern: '^[A-Z]' } } } });
      expect(parse(result).result).toEqual(report);
      expect(calls.map((call) => call.tool)).toEqual(['project.lint']);
    } finally {
      await close();
    }
  });

  it('with fix: true applies only the safe finding, through a plan and its apply', async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const { mcp, close } = await connect(calls);
    try {
      const result = await mcp.callTool({
        name: 'ae_do',
        arguments: { op: 'project.lint', args: { naming: { pattern: '^[A-Z]', fix: { match: 'tmp', replace: 'Tmp' } }, fix: true } },
      });
      const body = parse(result);
      expect(body.fixes).toEqual([
        expect.objectContaining({ item: 'Main / tmp layer', rule: 'naming', applied: true }),
      ]);
      // plan: dry run; apply: dry run again to check the fingerprint, then the real run.
      const renames = calls.filter((call) => call.tool === 'bulk.rename');
      expect(renames.map((call) => call.args.dryRun)).toEqual([true, true, false]);
      expect(calls.some((call) => call.tool === 'project.lint' && call.args.fix === true)).toBe(true);
    } finally {
      await close();
    }
  });
});
