import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
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
import { bridgeVersionWarning } from './bridge-version.js';
import { isValidCheckpointName, readCheckpoints, saveCheckpoint } from './checkpoints.js';
import { buildAeContext } from './context.js';
import { dismissFrontDialog, listDialogs } from './dialogs.js';
import { compareFrames, type FrameComparison } from './frame-compare.js';
import { JobStore } from './jobs.js';
import {
  closestNames,
  defaultOperationRegistry,
  validateOperationArgs,
  type OperationRegistry,
} from './operations.js';
import { selectTransport, type Runner } from './osascript-transport.js';
import { PlanStore } from './plans.js';
import { batchHasDestructive, batchRunBlock, evalRunEnabled, isPermitted } from './policy.js';
import { cleanupPartialOutput } from './render-output.js';
import { loadSettings, type Settings } from './settings.js';
import { runSetupChecks, type SetupDeps } from './setup-checks.js';

export const SERVER_NAME = 'ae-mcp';
export const SERVER_VERSION = '1.4.1';
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
  /** Update-check seams for check_setup (release source, clock, env opt-out). */
  updateCheck?: SetupDeps['updateCheck'];
  /** Test seam for the aerender process spawner. */
  spawnAerender?: SpawnAerender;
  /** Background job registry; a fresh one is created when omitted. */
  jobStore?: JobStore;
  /** Plan registry for previewed bulk edits; a fresh one is created when omitted. */
  planStore?: PlanStore<BulkStep>;
  /** MCP `instructions` returned to the client on initialize (docs/agents/animation-principles.md). */
  instructions?: string;
  /** How long `ae_render_frame` waits for AE to finish writing the PNG (test seam). */
  frameWait?: FrameWait;
  /** Compares two rendered frames for `ae_render_frame` `compareWith` (test seam). */
  frameCompare?: (beforePng: string, afterPng: string) => Promise<FrameComparison>;
}

/** One operation invocation stored in a previewed bulk plan. */
export interface BulkStep {
  op: string;
  args: Record<string, unknown>;
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

/** Records the path of the project file produced by the last successful incremental save, so
`check_setup` can name it later. */
async function persistSavedVersionPath(root: string, savedFile: string): Promise<void> {
  await mkdir(join(root, 'bridge'), { recursive: true });
  await writeFile(join(root, 'bridge', 'last-saved-version'), savedFile);
}

/** Reads a frame the bridge rendered, refusing anything outside `<root>/render`.
`downscale` is called when the file exceeds `maxBytes`, and should return the path
of a smaller file (or null when it cannot resize). */
export type FrameDownscale = (file: string) => Promise<string | null>;

/** Longest edge a rendered frame is scaled down to when it is too large to return. */
export const MAX_RENDER_EDGE = 1568;

const execFileAsync = promisify(execFile);

/** Downscales a PNG so its longest edge is `maxEdge`, using the macOS `sips`
tool, and returns the new path (null when `sips` is unavailable or fails). */
async function shrinkPng(file: string, maxEdge: number): Promise<string | null> {
  const out = file.replace(/\.[^./\\]+$/, '') + `-${maxEdge}.png`;
  try {
    await execFileAsync('sips', ['-Z', String(maxEdge), file, '--out', out]);
    return out;
  } catch {
    return null;
  }
}

/** How long to wait for AE to finish writing a rendered frame. */
export type FrameWait = { timeoutMs: number; intervalMs: number };

const DEFAULT_FRAME_WAIT: FrameWait = { timeoutMs: 15_000, intervalMs: 100 };

// Every complete PNG ends with this 12-byte IEND chunk (length 0, "IEND", CRC).
const PNG_IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

/** Polls until `file` is a complete PNG. `CompItem.saveFrameToPng` returns a
DeferredCall that resolves only "once the file has been written", so the bridge
reports the path before AE has written it (#176). */
async function waitForCompletePng(file: string, wait: FrameWait): Promise<Buffer | null> {
  const deadline = Date.now() + wait.timeoutMs;
  for (;;) {
    try {
      const buffer = await readFile(file);
      if (buffer.length >= PNG_IEND.length && buffer.subarray(buffer.length - PNG_IEND.length).equals(PNG_IEND)) {
        return buffer;
      }
    } catch {
      // Not created yet; keep waiting.
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await new Promise((done) => setTimeout(done, wait.intervalMs));
  }
}

/** True when `file` resolves to `<root>/render` or a path inside it. */
export function isInsideRenderDir(root: string, file: string): boolean {
  const renderDir = resolve(root, 'render');
  const target = resolve(file);
  return target === renderDir || target.startsWith(renderDir + sep);
}

export async function readRenderedFrame(
  root: string,
  file: string,
  maxBytes: number,
  downscale?: FrameDownscale,
  wait: FrameWait = DEFAULT_FRAME_WAIT,
): Promise<{ ok: true; data: string } | { ok: false; message: string }> {
  const target = resolve(file);
  if (!isInsideRenderDir(root, file)) {
    return { ok: false, message: `refusing to read outside the render directory: ${file}` };
  }
  let buffer = await waitForCompletePng(target, wait);
  if (!buffer) {
    return {
      ok: false,
      message: `rendered frame was not finished writing after ${wait.timeoutMs} ms: ${file}`,
    };
  }
  if (buffer.length > maxBytes && downscale) {
    const smaller = await downscale(target);
    if (smaller) {
      try {
        buffer = await readFile(smaller);
      } catch {
        // Keep the original buffer; the size check below reports the problem.
      }
    }
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
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: options.instructions },
  );
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
      applicationsDir: options.applicationsDir,
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

  // The E13 guard: Increment and Save before a destructive operation. The bridge
  // raises UNSAVED_PROJECT for a never-saved project (#181); any other failure is
  // surfaced with its real message (#161).
  const incrementBeforeDestructive = async (
    op: string,
  ): Promise<
    { ok: true; info: Record<string, unknown> | null } | { ok: false; result: ToolResult }
  > => {
    const increment = await callRaw('project.increment_save');
    if (!increment.ok) {
      if (increment.error.code === 'UNSAVED_PROJECT') {
        return {
          ok: false,
          result: text(
            makeError('UNSAVED_PROJECT', `operation '${op}' is destructive and the project has never been saved`),
            true,
          ),
        };
      }
      return {
        ok: false,
        result: text(
          makeError(
            'SCRIPT_ERROR',
            `operation '${op}' is destructive and the pre-increment save failed: ${increment.error.message}`,
          ),
          true,
        ),
      };
    }
    const saved = increment.result as { file?: unknown } | null;
    if (typeof saved?.file !== 'string') {
      return { ok: true, info: null };
    }
    await persistSavedVersionPath(root, saved.file);
    return { ok: true, info: { incrementedFile: saved.file } };
  };

  const jobStore = options.jobStore ?? new JobStore();
  const planStore = options.planStore ?? new PlanStore<BulkStep>();

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
        expectedOperations: operations.names(),
        expectedBridgeVersion: SERVER_VERSION,
        serverVersion: SERVER_VERSION,
        updateCheck: options.updateCheck,
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
    'ae_expression_report',
    {
      description:
        'List every expression-driven property on the layers of a composition (default: the active comp). Pass layer indices to select a subset, or omit to report every layer.',
      inputSchema: {
        comp: z.union([z.string(), z.number()]).optional(),
        layers: z.array(z.number()).optional(),
      },
    },
    async (args) => {
      const result = await callRaw('ae_expression_report', {
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

  // Named checkpoints (checkpoints.ts): an incremental save recorded under a name.
  server.registerTool(
    'checkpoint_create',
    {
      description:
        'Name a restore point: runs File > Increment and Save and records the new versioned project file under name (1-64 characters: letters, digits, space, _ or -). Reusing a name replaces it. Needs a saved project.',
      inputSchema: { name: z.string() },
    },
    async (args) => {
      const settings = await getSettings();
      if (settings.readOnly) {
        return text(
          makeError('FORBIDDEN', 'checkpoint_create saves the project and is not permitted in read-only mode'),
          true,
        );
      }
      if (!isValidCheckpointName(args.name)) {
        return text(
          makeError('INVALID_ARGS', 'checkpoint name must be 1-64 characters: letters, digits, space, _ or -'),
          true,
        );
      }
      const saved = await callRaw('project.increment_save');
      if (!saved.ok) {
        return toResult(saved);
      }
      const file = (saved.result as { file?: unknown } | null)?.file;
      if (typeof file !== 'string') {
        return text(
          makeError('UNSAVED_PROJECT', 'checkpoint_create needs a saved project; save it once first'),
          true,
        );
      }
      await persistSavedVersionPath(root, file);
      const checkpoint = { name: args.name, file, createdAt: new Date().toISOString() };
      await saveCheckpoint(root, checkpoint);
      return text(checkpoint);
    },
  );

  server.registerTool(
    'checkpoint_list',
    {
      description: 'List the named checkpoints, newest first.',
      inputSchema: {},
    },
    async () => text({ checkpoints: (await readCheckpoints(root)).reverse() }),
  );

  server.registerTool(
    'checkpoint_revert',
    {
      description:
        'Reopen the project file of a named checkpoint (destructive). Runs File > Increment and Save first so the current state is kept as a version. Refused in read-only mode.',
      inputSchema: { name: z.string() },
    },
    async (args) => {
      const settings = await getSettings();
      if (settings.readOnly) {
        return text(
          makeError('FORBIDDEN', 'checkpoint_revert reopens the project and is not permitted in read-only mode'),
          true,
        );
      }
      if (!isValidCheckpointName(args.name)) {
        return text(
          makeError('INVALID_ARGS', 'checkpoint name must be 1-64 characters: letters, digits, space, _ or -'),
          true,
        );
      }
      const checkpoint = (await readCheckpoints(root)).find((entry) => entry.name === args.name);
      if (!checkpoint) {
        return text(makeError('INVALID_ARGS', `unknown checkpoint: ${args.name}`), true);
      }
      const guard = await incrementBeforeDestructive('checkpoint_revert');
      if (!guard.ok) {
        return guard.result;
      }
      const opened = await callRaw('project.open', { path: checkpoint.file, force: true });
      if (!opened.ok) {
        return toResult(opened);
      }
      return text({
        name: checkpoint.name,
        file: checkpoint.file,
        incrementedFile: guard.info?.incrementedFile ?? null,
        opened: opened.result,
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
        'Render a single frame of a composition (default: the active comp, frame 0) to PNG and return it as image content plus metadata. Frames too large to return are downscaled so their longest edge is maxEdge (default 1568). compareWith (a previous frame path inside the render folder) adds compare: {changedPercent, meanDelta, bbox} against the new frame.',
      inputSchema: {
        comp: z.union([z.string(), z.number()]).optional(),
        time: z.number().optional(),
        maxEdge: z.number().int().positive().optional(),
        compareWith: z.string().optional(),
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
      const maxEdge = args.maxEdge ?? MAX_RENDER_EDGE;
      const read = await readRenderedFrame(
        root,
        value.file,
        MAX_RENDER_BYTES,
        (file) => shrinkPng(file, maxEdge),
        options.frameWait,
      );
      if (!read.ok) {
        return text(makeError('SCRIPT_ERROR', read.message), true);
      }
      let compare: FrameComparison | undefined;
      if (args.compareWith !== undefined) {
        if (!isInsideRenderDir(root, args.compareWith)) {
          return text(
            makeError('INVALID_ARGS', `compareWith must be a frame inside the render directory: ${args.compareWith}`),
            true,
          );
        }
        const before = resolve(args.compareWith);
        const exists = await stat(before).then((info) => info.isFile(), () => false);
        if (!exists) {
          return text(makeError('INVALID_ARGS', `compareWith frame does not exist: ${args.compareWith}`), true);
        }
        try {
          compare = await (options.frameCompare ?? compareFrames)(before, resolve(value.file));
        } catch (error) {
          return text(
            makeError('SCRIPT_ERROR', `frame comparison failed: ${error instanceof Error ? error.message : String(error)}`),
            true,
          );
        }
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
              ...(compare !== undefined ? { compare } : {}),
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
      const settings = await getSettings();
      if (settings.readOnly) {
        return text(
          makeError('FORBIDDEN', 'ae_render writes files and is not permitted in read-only mode'),
          true,
        );
      }
      if ((args.comp === undefined) === (args.rqindex === undefined)) {
        return text(
          makeError('INVALID_ARGS', 'aerender needs exactly one of comp or rqindex'),
          true,
        );
      }
      // Never overwrite, and never let cancel delete, a file that already exists (#201).
      const outputExists =
        args.output !== undefined && (await stat(args.output).then(() => true, () => false));
      if (outputExists) {
        return text(makeError('INVALID_ARGS', `output already exists: ${args.output}`), true);
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
    'ae_dialogs',
    {
      description:
        "List the modal dialogs open in After Effects (title and text), or dismiss the frontmost one. A dialog blocks every other tool. 'dismiss' presses Cancel (or Escape) and never Save or Don't Save. Needs Accessibility permission for the MCP client.",
      inputSchema: { action: z.enum(['list', 'dismiss']).default('list') },
    },
    async (args) => {
      if (args.action === 'dismiss') {
        const dismissed = await dismissFrontDialog(options.runner);
        return dismissed.ok
          ? text({ dismissed: dismissed.value })
          : text(makeError('SCRIPT_ERROR', dismissed.message), true);
      }
      const listed = await listDialogs(options.runner);
      return listed.ok
        ? text({ dialogs: listed.value })
        : text(makeError('SCRIPT_ERROR', listed.message), true);
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
        'Run a named operation from ae_catalog. Arguments are validated against the operation schema before reaching After Effects. Call get_selection for the active comp and selection.',
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
      const validation = validateOperationArgs(definition.schema, toolArgs.args, definition.required);
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
      let incrementInfo: Record<string, unknown> | null = null;
      if (needsIncrement && settings.incrementBeforeDestructive) {
        const increment = await incrementBeforeDestructive(toolArgs.op);
        if (!increment.ok) {
          return increment.result;
        }
        incrementInfo = increment.info;
      }
      // The bridge undoes only after a step that changes the project, so the
      // flags come from the registry, never from the client.
      const bridgeArgs =
        definition.name === 'batch.run'
          ? {
              ...validation.args,
              mutating: (validation.args.ops as Array<{ op: string }>).map(
                (sub) => operations.get(sub.op)?.readOnly === false,
              ),
            }
          : validation.args;
      const result = await callRaw(definition.name, bridgeArgs);
      if (!result.ok) {
        // Never undo by script: any scripted Edit > Undo raises AE's modal "Undo
        // group mismatch" and blocks the bridge (ADR-0009). The batch is one undo
        // step, so the user reverts it with a single Cmd+Z.
        if ((result.error as { rollback?: boolean }).rollback === true) {
          delete (result.error as { rollback?: boolean }).rollback;
          result.error.message +=
            '. The earlier steps are still applied; press Cmd+Z (Edit > Undo) once in After Effects to revert the whole batch.';
        }
        return toResult(result);
      }
      const payload: Record<string, unknown> = { result: result.result };
      if (incrementInfo) {
        payload.increment = incrementInfo;
      }
      const versionWarning = await bridgeVersionWarning(root, SERVER_VERSION);
      if (versionWarning !== undefined) {
        payload.warning = versionWarning;
      }
      const size = Buffer.byteLength(JSON.stringify(payload));
      if (size > maxResultBytes) {
        return text(
          makeError(
            'INVALID_ARGS',
            `result is ${size} bytes, over the ${maxResultBytes}-byte limit; narrow the request (index, depth, comp)`,
          ),
          true,
        );
      }
      return text(payload);
    },
  );

  server.registerTool(
    'ae_plan',
    {
      description:
        'Preview a bulk operation (an ae_catalog operation in the "bulk" category) and register it as a plan without changing the project. Returns {planId, changes}. Apply it with ae_apply.',
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
        return text(makeError('UNKNOWN_TOOL', `unknown operation '${toolArgs.op}'.${suffix}`), true);
      }
      if (definition.category !== 'bulk') {
        return text(
          makeError('INVALID_ARGS', `operation '${toolArgs.op}' is not a bulk operation`),
          true,
        );
      }
      const validation = validateOperationArgs(definition.schema, toolArgs.args, definition.required);
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
      const dry =await callRaw(definition.name, { ...validation.args, dryRun: true });
      if (!dry.ok) {
        return toResult(dry);
      }
      const value = dry.result as { changes?: unknown[]; fingerprint?: unknown } | null;
      if (typeof value?.fingerprint !== 'string') {
        return text(
          makeError('SCRIPT_ERROR', `operation '${toolArgs.op}' did not return a plan fingerprint`),
          true,
        );
      }
      const planId = planStore.create(
        [{ op: definition.name, args: validation.args }],
        value.fingerprint,
      );
      return text({ planId, changes: value.changes ?? [] });
    },
  );

  server.registerTool(
    'ae_apply',
    {
      description:
        'Apply a bulk plan registered by ae_plan, running the planned operation as one undo group. Refuses a plan that has expired or was made before the project changed.',
      inputSchema: {
        planId: z.string(),
      },
    },
    async (toolArgs) => {
      const peeked = planStore.peek(toolArgs.planId);
      if (peeked === undefined) {
        return text(makeError('UNKNOWN_PLAN', `no plan with id '${toolArgs.planId}'`), true);
      }
      const step = peeked.steps[0];
      if (step === undefined) {
        return text(makeError('SCRIPT_ERROR', `plan '${toolArgs.planId}' has no steps`), true);
      }
      if (operations.get(step.op) === undefined) {
        return text(
          makeError('UNKNOWN_TOOL', `plan references unknown operation '${step.op}'`),
          true,
        );
      }
      const dry = await callRaw(step.op, { ...step.args, dryRun: true });
      if (!dry.ok) {
        return toResult(dry);
      }
      const current = (dry.result as { fingerprint?: unknown } | null)?.fingerprint;
      const taken = planStore.take(toolArgs.planId, typeof current === 'string' ? current : '');
      if (!taken.ok) {
        if (taken.reason === 'expired') {
          return text(makeError('PLAN_EXPIRED', `plan '${toolArgs.planId}' has expired`), true);
        }
        if (taken.reason === 'changed') {
          return text(
            makeError('PLAN_CHANGED', 'the project changed since the plan was made'),
            true,
          );
        }
        return text(makeError('UNKNOWN_PLAN', `no plan with id '${toolArgs.planId}'`), true);
      }

      const stepDefinition = operations.get(step.op);
      const settings = await getSettings();
      const needsIncrement =
        stepDefinition?.destructive === true && settings.incrementBeforeDestructive;
      let incrementInfo: Record<string, unknown> | null = null;
      if (needsIncrement) {
        const increment = await incrementBeforeDestructive(step.op);
        if (!increment.ok) {
          return increment.result;
        }
        incrementInfo = increment.info;
      }

      const result = await callRaw(step.op, { ...step.args, dryRun: false });
      if (!result.ok) {
        return toResult(result);
      }
      const payload: Record<string, unknown> = { planId: toolArgs.planId, op: step.op, result: result.result };
      if (incrementInfo) {
        payload.increment = incrementInfo;
      }
      return text(payload);
    },
  );

  return server;
}
