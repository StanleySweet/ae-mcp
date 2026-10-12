import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {
  discoverAerenders,
  runAerender,
  type AerenderResult,
  type AerenderRunHandle,
  type SpawnAerender,
} from '@ae-mcp/core';
import { makeError, queueRoot, type ResultMessage } from '@ae-mcp/protocol';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createAEClient, type AEClient } from './ae-client.js';
import { buildAeContext } from './context.js';
import { JobStore } from './jobs.js';
import {
  closestNames,
  defaultOperationRegistry,
  validateOperationArgs,
  type OperationRegistry,
} from './operations.js';
import { selectTransport, type Runner } from './osascript-transport.js';
import { batchHasDestructive, batchRunBlock, evalRunEnabled, isPermitted } from './policy.js';
import { cleanupPartialOutput } from './render-output.js';
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
  /** Explicit aerender executable; when omitted it is discovered under `applicationsDir`. */
  aerender?: string;
  /** Test seam for the aerender process spawner. */
  spawnAerender?: SpawnAerender;
  /** Background job registry; a fresh one is created when omitted. */
  jobStore?: JobStore;
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

  const jobStore = options.jobStore ?? new JobStore();

  /** Running render jobs, keyed by job id, so they can be cancelled. */
  const runs = new Map<string, { cancel: () => void; done: Promise<void> }>();

  const findAerender = async (): Promise<string | null> => {
    if (options.aerender !== undefined) {
      return options.aerender;
    }
    const installs = await discoverAerenders(options.applicationsDir);
    return installs[0]?.aerender ?? null;
  };

  /** Resolves the project file aerender should open, defaulting to the open project. */
  const resolveProject = async (
    explicit: string | undefined,
  ): Promise<{ ok: true; file: string } | { ok: false; result: ToolResult }> => {
    if (explicit !== undefined) {
      return { ok: true, file: explicit };
    }
    const info = await callRaw('ae_project_info');
    if (!info.ok) {
      return { ok: false, result: toResult(info) };
    }
    const file = (info.result as { file?: string | null } | null)?.file;
    if (typeof file !== 'string' || file === '') {
      return {
        ok: false,
        result: text(
          makeError(
            'UNSAVED_PROJECT',
            'aerender needs a saved project file; save it in After Effects or pass project explicitly',
          ),
          true,
        ),
      };
    }
    return { ok: true, file };
  };

  const finishRenderJob = async (
    jobId: string,
    result: AerenderResult,
    cleanup: { output: string | undefined; startedAt: number },
  ): Promise<void> => {
    if (result.cancelled) {
      if (cleanup.output !== undefined) {
        await cleanupPartialOutput(cleanup.output, cleanup.startedAt).catch(() => undefined);
      }
      jobStore.cancel(jobId);
      return;
    }
    if (result.code === 0) {
      jobStore.succeed(jobId, { exitCode: 0 });
      return;
    }
    const line = [...result.errors, ...result.output]
      .reverse()
      .find((entry) => entry.trim() !== '');
    jobStore.fail(jobId, line ?? `aerender exited with code ${result.code ?? 'unknown'}`);
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
    'ae_render',
    {
      description:
        'Start an aerender render of a composition (comp) or a render-queue item (rqindex) as a background job and return its jobId. Poll progress and the result with job_status.',
      inputSchema: {
        comp: z.string().optional(),
        rqindex: z.number().int().positive().optional(),
        output: z.string().optional(),
        omTemplate: z.string().optional(),
        rsTemplate: z.string().optional(),
        startFrame: z.number().int().optional(),
        endFrame: z.number().int().optional(),
        increment: z.number().int().positive().optional(),
        project: z.string().optional(),
      },
    },
    async (args) => {
      if ((args.comp === undefined) === (args.rqindex === undefined)) {
        return text(
          makeError('INVALID_ARGS', 'aerender needs exactly one of comp or rqindex'),
          true,
        );
      }
      const aerender = await findAerender();
      if (aerender === null) {
        return text(makeError('AERENDER_NOT_FOUND', 'no aerender executable was found'), true);
      }
      const project = await resolveProject(args.project);
      if (!project.ok) {
        return project.result;
      }
      const jobId = jobStore.start('render');
      const startedAt = jobStore.get(jobId)?.createdAt ?? Date.now();
      let handle: AerenderRunHandle;
      try {
        handle = runAerender({
          aerender,
          project: project.file,
          comp: args.comp,
          rqindex: args.rqindex,
          output: args.output,
          omTemplate: args.omTemplate,
          rsTemplate: args.rsTemplate,
          startFrame: args.startFrame,
          endFrame: args.endFrame,
          increment: args.increment,
          spawn: options.spawnAerender,
          onEvent: (event) => {
            if (event.type === 'progress') {
              jobStore.progress(jobId, {
                frame: event.frame,
                rendered: event.rendered,
                seconds: event.seconds,
              });
            }
          },
        });
      } catch (error) {
        const message = (error as Error).message;
        jobStore.fail(jobId, message);
        return text(makeError('SCRIPT_ERROR', `could not start aerender: ${message}`), true);
      }
      const done = handle.result.then((result) =>
        finishRenderJob(jobId, result, { output: args.output, startedAt }),
      );
      runs.set(jobId, { cancel: handle.cancel, done });
      void done.finally(() => runs.delete(jobId));
      return text({ jobId });
    },
  );

  server.registerTool(
    'job_status',
    {
      description:
        'Report the status, progress and result of a background job started by ae_render.',
      inputSchema: {
        jobId: z.string(),
      },
    },
    async (args) => {
      const record = jobStore.get(args.jobId);
      if (record === undefined) {
        return text(makeError('UNKNOWN_JOB', `no job with id '${args.jobId}'`), true);
      }
      return text(record);
    },
  );

  server.registerTool(
    'job_cancel',
    {
      description:
        'Cancel a running background job, stop its aerender process and remove any partial output. Returns the final job record.',
      inputSchema: {
        jobId: z.string(),
      },
    },
    async (args) => {
      const record = jobStore.get(args.jobId);
      if (record === undefined) {
        return text(makeError('UNKNOWN_JOB', `no job with id '${args.jobId}'`), true);
      }
      const run = runs.get(args.jobId);
      if (run === undefined) {
        return text(record);
      }
      run.cancel();
      await run.done;
      return text(jobStore.get(args.jobId) ?? record);
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
