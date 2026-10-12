import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { makeError, queueRoot, type ResultMessage } from '@ae-mcp/protocol';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createAEClient, type AEClient } from './ae-client.js';
import { buildAeContext } from './context.js';
import {
  closestNames,
  defaultOperationRegistry,
  validateOperationArgs,
  type OperationRegistry,
} from './operations.js';
import { selectTransport, type Runner } from './osascript-transport.js';
import { batchHasDestructive, batchRunBlock, evalRunEnabled, isPermitted } from './policy.js';
import { loadSettings, type Settings } from './settings.js';
import { runSetupChecks } from './setup-checks.js';

export const SERVER_NAME = 'ae-mcp';
export const SERVER_VERSION = '0.0.0';
export const MAX_RESULT_BYTES = 200_000;
export const MAX_RENDER_BYTES = 20_000_000;

export interface ServerOptions {
  root?: string;
  applicationsDir?: string;
  appName?: string;
  runner?: Runner;
  client?: AEClient;
  maxResultBytes?: number;
  operations?: OperationRegistry;
  settings?: Settings;
}

type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

type ToolResult = {
  content: ToolContent[];
  isError?: boolean;
};

function text(value: unknown, isError = false): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], isError };
}

function toResult(value: ResultMessage): ToolResult {
  return value.ok ? text(value.result) : text(value.error, true);
}

/** Reads a frame the bridge rendered, refusing anything outside `<root>/render`. */
async function readRenderedFrame(
  root: string,
  file: string,
  maxBytes: number,
): Promise<{ ok: true; data: string } | { ok: false; message: string }> {
  const renderDir = resolve(root, 'render');
  const target = resolve(file);
  if (target !== renderDir && !target.startsWith(renderDir + sep)) {
    return { ok: false, message: `refusing to read outside the render directory: ${file}` };
  }
  let buffer: Buffer;
  try {
    buffer = await readFile(target);
  } catch (error) {
    return { ok: false, message: `could not read rendered frame: ${(error as Error).message}` };
  }
  if (buffer.length > maxBytes) {
    return { ok: false, message: `rendered frame is too large (${buffer.length} bytes)` };
  }
  return { ok: true, data: buffer.toString('base64') };
}

/** Keeps the longest prefix of an array whose JSON fits the byte cap. */
export function capArray<T>(
  items: T[],
  maxBytes: number,
): { items: T[]; truncated: boolean } {
  if (JSON.stringify(items).length <= maxBytes) {
    return { items, truncated: false };
  }
  for (let kept = items.length - 1; kept >= 0; kept -= 1) {
    if (JSON.stringify(items.slice(0, kept)).length <= maxBytes) {
      return { items: items.slice(0, kept), truncated: true };
    }
  }
  return { items: [], truncated: true };
}

export function createServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const root = options.root ?? queueRoot();
  const maxResultBytes = options.maxResultBytes ?? MAX_RESULT_BYTES;
  const operations = options.operations ?? defaultOperationRegistry();

  let clientPromise: Promise<AEClient> | undefined;
  const getClient = (): Promise<AEClient> => {
    if (options.client) {
      return Promise.resolve(options.client);
    }
    clientPromise ??= selectTransport({
      root,
      appName: options.appName,
      runner: options.runner,
    }).then((transport) => createAEClient({ transport, root }));
    return clientPromise;
  };

  let settingsPromise: Promise<Settings> | undefined;
  const getSettings = (): Promise<Settings> => {
    settingsPromise ??= options.settings ? Promise.resolve(options.settings) : loadSettings({ root });
    return settingsPromise;
  };

  const callRaw = async (tool: string, args: unknown = null): Promise<ResultMessage> => {
    const client = await getClient();
    return client.call(tool, args);
  };

  server.registerTool(
    'check_setup',
    {
      description:
        'Report whether After Effects, the bridge and queue permissions are ready, with a fix for each failed check.',
      inputSchema: {},
    },
    async () => {
      const checks = await runSetupChecks({
        root,
        applicationsDir: options.applicationsDir,
      });
      return text(checks);
    },
  );

  server.registerTool(
    'ae_context',
    {
      description:
        'Report the live connection context: active transport, AE and bridge versions, capabilities and busy state.',
      inputSchema: {},
    },
    async () => text(await buildAeContext(root)),
  );

  server.registerTool(
    'ae_project_info',
    {
      description:
        'Report the open project: file, color depth, item count, active item and every item summary.',
      inputSchema: {},
    },
    async () => toResult(await callRaw('ae_project_info')),
  );

  server.registerTool(
    'ae_comp_info',
    {
      description:
        'Report one or more compositions by name or id. Omit comps to report every composition.',
      inputSchema: {
        comps: z.array(z.union([z.string(), z.number()])).optional(),
      },
    },
    async (args) => {
      const result = await callRaw('ae_comp_info', { comps: args.comps ?? [] });
      if (!result.ok) {
        return toResult(result);
      }
      const value = result.result as { comps?: unknown[]; missing?: unknown[] };
      const capped = capArray(value.comps ?? [], maxResultBytes);
      return text({
        comps: capped.items,
        missing: value.missing ?? [],
        truncated: capped.truncated,
      });
    },
  );

  server.registerTool(
    'ae_layer_info',
    {
      description:
        'Report layers of a composition (default: the active comp). Pass layer indices to select a subset, or omit to report every layer.',
      inputSchema: {
        comp: z.union([z.string(), z.number()]).optional(),
        layers: z.array(z.number()).optional(),
      },
    },
    async (args) => {
      const result = await callRaw('ae_layer_info', {
        comp: args.comp,
        layers: args.layers,
      });
      if (!result.ok) {
        return toResult(result);
      }
      const value = result.result as {
        comp?: string | null;
        layers?: unknown[];
        missing?: unknown[];
      };
      const capped = capArray(value.layers ?? [], maxResultBytes);
      return text({
        comp: value.comp ?? null,
        layers: capped.items,
        missing: value.missing ?? [],
        truncated: capped.truncated,
      });
    },
  );

  server.registerTool(
    'ae_version_info',
    {
      description:
        'Probe the running bridge for the live AE version, bridge version and registered capabilities.',
      inputSchema: {},
    },
    async () => toResult(await callRaw('ae_version_info')),
  );

  server.registerTool(
    'get_selection',
    {
      description:
        'Report the current selection: the active composition and its selected layers, or the selected items in the project panel.',
      inputSchema: {},
    },
    async () => toResult(await callRaw('get_selection')),
  );

  server.registerTool(
    'find',
    {
      description:
        'Find comps, layers and properties whose name or match name contains a query. Restrict with kinds.',
      inputSchema: {
        query: z.string(),
        kinds: z.array(z.enum(['comp', 'layer', 'property'])).optional(),
      },
    },
    async (args) => {
      const result = await callRaw('find', { query: args.query, kinds: args.kinds });
      if (!result.ok) {
        return toResult(result);
      }
      const value = result.result as {
        comps?: unknown[];
        layers?: unknown[];
        properties?: unknown[];
      };
      const layers = capArray(value.layers ?? [], maxResultBytes);
      const properties = capArray(value.properties ?? [], maxResultBytes);
      return text({
        comps: value.comps ?? [],
        layers: layers.items,
        properties: properties.items,
        truncated: layers.truncated || properties.truncated,
      });
    },
  );

  server.registerTool(
    'ae_render_frame',
    {
      description:
        'Render a single frame of a composition (default: the active comp, frame 0) to PNG and return it as image content plus metadata.',
      inputSchema: {
        comp: z.union([z.string(), z.number()]).optional(),
        time: z.number().optional(),
      },
    },
    async (args) => {
      const result = await callRaw('render.frame', { comp: args.comp, time: args.time });
      if (!result.ok) {
        return toResult(result);
      }
      const value = result.result as {
        method?: string;
        comp?: string | null;
        file?: string;
        time?: number;
        frame?: number;
        width?: number;
        height?: number;
      };
      if (typeof value.file !== 'string') {
        return text(
          makeError('SCRIPT_ERROR', 'render.frame did not return a file path'),
          true,
        );
      }
      const read = await readRenderedFrame(root, value.file, MAX_RENDER_BYTES);
      if (!read.ok) {
        return text(makeError('SCRIPT_ERROR', read.message), true);
      }
      return {
        content: [
          { type: 'image', data: read.data, mimeType: 'image/png' },
          {
            type: 'text',
            text: JSON.stringify({
              method: value.method ?? null,
              comp: value.comp ?? null,
              file: value.file,
              time: value.time ?? null,
              frame: value.frame ?? null,
              width: value.width ?? null,
              height: value.height ?? null,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'ae_catalog',
    {
      description:
        'List the operations available through ae_do, optionally filtered to one category.',
      inputSchema: {
        category: z.string().optional(),
      },
    },
    async (args) => {
      const settings = await getSettings();
      const allowed = operations
        .list(args.category)
        .filter((definition) => isPermitted(definition, settings) && evalRunEnabled(definition, settings));
      return text({ operations: allowed });
    },
  );

  server.registerTool(
    'ae_do',
    {
      description:
        'Run a named operation from ae_catalog. Arguments are validated against the operation schema before reaching After Effects, and the response carries the ambient context (active comp and selection).',
      inputSchema: {
        op: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (toolArgs) => {
      const definition = operations.get(toolArgs.op);
      if (definition === undefined) {
        const suggestions = closestNames(operations.names(), toolArgs.op);
        const suffix = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
        return text(
          makeError('UNKNOWN_TOOL', `unknown operation '${toolArgs.op}'.${suffix}`),
          true,
        );
      }
      const validation = validateOperationArgs(definition.schema, toolArgs.args);
      if (!validation.ok) {
        return text(makeError('INVALID_ARGS', validation.message), true);
      }
      const settings = await getSettings();
      if (!isPermitted(definition, settings)) {
        return text(
          makeError('FORBIDDEN', `operation '${toolArgs.op}' is not permitted by the current policy`),
          true,
        );
      }
      if (!evalRunEnabled(definition, settings)) {
        return text(
          makeError(
            'FORBIDDEN',
            'eval.run is disabled. Set evalEnabled in settings.json or AE_MCP_EVAL_ENABLED=1 to enable it.',
          ),
          true,
        );
      }
      const blocked =
        definition.name === 'batch.run'
          ? batchRunBlock(operations, validation.args.ops, settings)
          : null;
      if (blocked) {
        return text(makeError(blocked.code, blocked.message), true);
      }
      const needsIncrement =
        definition.destructive ||
        (definition.name === 'batch.run' && batchHasDestructive(operations, validation.args.ops));
      if (needsIncrement && settings.incrementBeforeDestructive) {
        const increment = await callRaw('project.increment_save');
        if (!increment.ok) {
          return toResult(increment);
        }
        const saved = increment.result as { success?: boolean } | null;
        if (!saved || saved.success !== true) {
          return text(
            makeError(
              'UNSAVED_PROJECT',
              `operation '${toolArgs.op}' is destructive and the project has never been saved`,
            ),
            true,
          );
        }
      }
      const result = await callRaw(definition.name, validation.args);
      if (!result.ok) {
        return toResult(result);
      }
      const selection = await callRaw('get_selection');
      return text({
        result: result.result,
        context: selection.ok ? selection.result : null,
      });
    },
  );

  return server;
}
