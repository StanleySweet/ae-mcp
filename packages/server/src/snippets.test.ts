import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { AEClient } from './ae-client.js';
import { defaultOperationRegistry } from './operations.js';
import { createServer } from './server.js';
import { runSetupChecks } from './setup-checks.js';
import {
  expandTemplate,
  loadUserSnippets,
  registerUserSnippets,
  resolveUserCall,
  SNIPPET_DIR,
  TEMPLATE_OP,
} from './snippets.js';

async function rootWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ae-mcp-snippets-'));
  const dir = join(root, SNIPPET_DIR);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  return root;
}

const goodExpression = JSON.stringify({
  kind: 'expression',
  name: 'house_wobble',
  description: 'Gentle wobble',
  expression: 'wiggle(2, 5)',
});

const goodTemplate = JSON.stringify({
  kind: 'template',
  name: 'rename_first',
  description: 'Rename layer 1',
  ops: [{ op: 'layer.rename', args: { index: 1, name: '{{name}}' } }],
});

describe('loadUserSnippets', () => {
  it('treats a missing snippets folder as no snippets and no error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-snippets-'));
    const loaded = loadUserSnippets(root, defaultOperationRegistry());
    expect(loaded).toEqual({ expressions: [], templates: [], problems: [] });
  });

  it('loads a valid expression and a valid template', async () => {
    const root = await rootWith({ 'a.json': goodExpression, 'b.json': goodTemplate });
    const loaded = loadUserSnippets(root, defaultOperationRegistry());
    expect(loaded.problems).toEqual([]);
    expect(loaded.expressions.map((item) => item.name)).toEqual(['house_wobble']);
    expect(loaded.templates.map((item) => item.name)).toEqual(['rename_first']);
  });

  it('skips invalid files and reports each with its file name and reason', async () => {
    const root = await rootWith({
      'broken.json': '{ not json',
      'builtin.json': JSON.stringify({ kind: 'expression', name: 'wiggle', description: 'x', expression: '1' }),
      'badop.json': JSON.stringify({
        kind: 'template',
        name: 'bad_op',
        description: 'x',
        ops: [{ op: 'project.save', args: {} }],
      }),
      'badarg.json': JSON.stringify({
        kind: 'template',
        name: 'bad_arg',
        description: 'x',
        ops: [{ op: 'layer.rename', args: { index: 'one', name: 'x' } }],
      }),
      'noname.json': JSON.stringify({ kind: 'expression', name: 'Has Space', description: 'x', expression: '1' }),
      'good.json': goodExpression,
    });
    const loaded = loadUserSnippets(root, defaultOperationRegistry());
    expect(loaded.expressions.map((item) => item.name)).toEqual(['house_wobble']);
    const reasons = Object.fromEntries(loaded.problems.map((problem) => [problem.file, problem.reason]));
    expect(Object.keys(reasons).sort()).toEqual(['badarg.json', 'badop.json', 'broken.json', 'builtin.json', 'noname.json']);
    expect(reasons['broken.json']).toMatch(/not valid JSON/);
    expect(reasons['builtin.json']).toMatch(/already used/);
    expect(reasons['badop.json']).toMatch(/cannot run inside a template/);
    expect(reasons['badarg.json']).toMatch(/must be a number/);
    expect(reasons['noname.json']).toMatch(/name must be/);
  });

  it('reports a second file that reuses a name', async () => {
    const root = await rootWith({ 'a.json': goodExpression, 'b.json': goodExpression });
    const loaded = loadUserSnippets(root, defaultOperationRegistry());
    expect(loaded.expressions).toHaveLength(1);
    expect(loaded.problems).toEqual([{ file: 'b.json', reason: expect.stringMatching(/already used/) }]);
  });
});

describe('user snippets in the registry and ae_do', () => {
  it('expandTemplate fills placeholders and keeps a whole-placeholder value typed', () => {
    const template = {
      name: 't',
      description: 'd',
      ops: [{ op: 'layer.rename', args: { index: '{{i}}', name: 'Hi {{name}}' } }],
    };
    const expanded = expandTemplate(template, { i: 3, name: 'there' });
    expect(expanded).toEqual({ ok: true, ops: [{ op: 'layer.rename', args: { index: 3, name: 'Hi there' } }] });
    expect(expandTemplate(template, { i: 3 })).toEqual({
      ok: false,
      message: "template 't' needs the argument 'name'",
    });
  });

  it('check_setup reports invalid snippet files with name and reason', async () => {
    const root = await rootWith({ 'broken.json': '{' });
    const loaded = loadUserSnippets(root, defaultOperationRegistry());
    const checks = await runSetupChecks({
      root,
      applicationsDir: root,
      snippetProblems: loaded.problems,
      heartbeatMaxAgeMs: 1,
    });
    const check = checks.find((item) => item.check === 'user_snippets');
    expect(check?.status).toBe('fail');
    expect(check?.fix).toContain('broken.json');
    expect(check?.detail).toContain('not valid JSON');
  });

  it('lists user snippets in ae_catalog and runs them through ae_do', async () => {
    const root = await rootWith({ 'a.json': goodExpression, 'b.json': goodTemplate });
    const sent: Array<{ tool: string; args: unknown }> = [];
    const stub = {
      call: async (tool: string, args: unknown) => {
        sent.push({ tool, args });
        return { ok: true as const, result: null };
      },
    } as unknown as AEClient;
    const server = createServer({ root, client: stub, operations: defaultOperationRegistry() });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcp = new Client({ name: 'snippets-test', version: '0.0.0' });
    await mcp.connect(clientTransport);
    try {
      const catalog = await mcp.callTool({ name: 'ae_catalog', arguments: { verbose: true } });
      const [first] = catalog.content as Array<{ text: string }>;
      const ops = (JSON.parse(first!.text) as { operations: Array<{ name: string; schema: Record<string, { enum?: string[] }> }> })
        .operations;
      expect(ops.find((op) => op.name === 'expression.snippet')?.schema.snippet?.enum).toContain('house_wobble');
      expect(ops.map((op) => op.name)).toContain(TEMPLATE_OP);

      await mcp.callTool({
        name: 'ae_do',
        arguments: { op: 'expression.snippet', args: { comp: 'Main', index: 2, property: 'Position', snippet: 'house_wobble' } },
      });
      expect(sent.at(-1)).toEqual({
        tool: 'expression.set',
        args: { comp: 'Main', index: 2, property: 'Position', value: 'wiggle(2, 5)' },
      });

      await mcp.callTool({
        name: 'ae_do',
        arguments: { op: TEMPLATE_OP, args: { name: 'rename_first', args: { name: 'Hero' } } },
      });
      expect(sent.at(-1)).toEqual({
        tool: 'batch.run',
        args: { ops: [{ op: 'layer.rename', args: { index: 1, name: 'Hero' } }], mutating: [true] },
      });

      const missing = await mcp.callTool({
        name: 'ae_do',
        arguments: { op: TEMPLATE_OP, args: { name: 'rename_first', args: {} } },
      });
      expect(missing.isError).toBe(true);
    } finally {
      await mcp.close();
    }
  });

  it('resolveUserCall leaves built-in calls untouched', () => {
    const empty = { expressions: [], templates: [], problems: [] };
    expect(resolveUserCall('expression.snippet', { snippet: 'wiggle' }, empty)).toEqual({
      ok: true,
      op: 'expression.snippet',
      args: { snippet: 'wiggle' },
    });
  });

  it('registers nothing extra when there are no user snippets', () => {
    const registry = defaultOperationRegistry();
    const before = registry.names().sort();
    registerUserSnippets(registry, { expressions: [], templates: [], problems: [] });
    expect(registry.names().sort()).toEqual(before);
  });
});
