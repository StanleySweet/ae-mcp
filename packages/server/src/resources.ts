import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';
import type { ResultMessage } from '@ae-mcp/protocol';
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// MCP resources (#231): the project state and the docs a client would otherwise
// read with tool calls. Fixed resources are listed as-is; `ae://comp/{name}` is a
// template that lists every comp and reads one by name.

/** Calls a bridge tool and returns its raw result, e.g. `createServer`'s callRaw. */
export type ResourceCall = (tool: string, args?: unknown) => Promise<ResultMessage>;

export interface ResourceOptions {
  call: ResourceCall;
  /** Text of skills/ae/SKILL.md. The skill resource is left out when absent. */
  skill?: string;
  /** A docs/findings directory. Each markdown file becomes a resource. */
  docsDir?: string;
}

async function bridgeJson(call: ResourceCall, tool: string, args?: unknown): Promise<unknown> {
  const result = await call(tool, args);
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.result;
}

function jsonContent(uri: URL, value: unknown): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  return {
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }],
  };
}

function markdownContent(uri: URL, text: string): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
}

/** Names of the compositions in the open project, for the template's list. */
async function compNames(call: ResourceCall): Promise<string[]> {
  const value = (await bridgeJson(call, 'ae_comp_info', { comps: [] })) as { comps?: Array<{ name?: unknown }> };
  return (value.comps ?? []).flatMap((comp) => (typeof comp.name === 'string' ? [comp.name] : []));
}

export function registerResources(server: McpServer, options: ResourceOptions): void {
  const { call } = options;

  server.registerResource(
    'project-items',
    'ae://project/items',
    {
      title: 'Project items',
      description: 'The open project: file, item count, active item and every item summary (ae_project_info).',
      mimeType: 'application/json',
    },
    async (uri) => jsonContent(uri, await bridgeJson(call, 'ae_project_info')),
  );

  server.registerResource(
    'active-comp',
    'ae://active-comp',
    {
      title: 'Active composition',
      description: 'Summary of the active composition: layers, timing and size (comp named by get_selection).',
      mimeType: 'application/json',
    },
    async (uri) => {
      const selection = (await bridgeJson(call, 'get_selection')) as { comp?: unknown } | null;
      if (typeof selection?.comp !== 'string') {
        return jsonContent(uri, null);
      }
      const info = await bridgeJson(call, 'ae_comp_info', { comps: [selection.comp] });
      return jsonContent(uri, (info as { comps?: unknown[] }).comps?.[0] ?? null);
    },
  );

  if (options.skill !== undefined) {
    const skill = options.skill;
    server.registerResource(
      'ae-skill',
      'ae://skill/ae',
      {
        title: 'ae skill',
        description: 'Recipes for driving After Effects through ae-mcp (skills/ae/SKILL.md).',
        mimeType: 'text/markdown',
      },
      async (uri) => markdownContent(uri, skill),
    );
  }

  if (options.docsDir !== undefined) {
    const docsDir = options.docsDir;
    const files = readdirSync(docsDir).filter((file) => file.endsWith('.md')).sort();
    for (const file of files) {
      server.registerResource(
        `finding-${file}`,
        `ae://docs/findings/${file}`,
        {
          title: `Finding: ${file}`,
          description: `Design finding from docs/findings/${file}.`,
          mimeType: 'text/markdown',
        },
        async (uri) => markdownContent(uri, readFileSync(join(docsDir, file), 'utf8')),
      );
    }
  }

  server.registerResource(
    'comp-by-name',
    new ResourceTemplate('ae://comp/{name}', {
      list: async () => {
        try {
          const names = await compNames(call);
          return {
            resources: names.map((name) => ({
              uri: `ae://comp/${encodeURIComponent(name)}`,
              name,
              mimeType: 'application/json',
            })),
          };
        } catch {
          // No project to list (AE closed or no bridge): the template still exists.
          return { resources: [] };
        }
      },
    }),
    {
      title: 'Composition by name',
      description: 'One composition by name (ae_comp_info), layers included.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const name = decodeURIComponent(String(variables.name));
      const info = (await bridgeJson(call, 'ae_comp_info', { comps: [name] })) as {
        comps?: unknown[];
        missing?: unknown[];
      };
      if ((info.comps ?? []).length === 0) {
        throw new Error(`composition not found: ${name}`);
      }
      return jsonContent(uri, info.comps?.[0]);
    },
  );
}
