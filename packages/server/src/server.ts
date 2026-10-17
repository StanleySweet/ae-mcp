import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  discoverAerenders,
  runAerender,
  type AerenderResult,
  type AerenderRunHandle,
  type SpawnAerender,
} from '@ae-mcp/core';
import {
  ERROR_HINTS_URI,
  errorHintDetails,
  makeError,
  queueRoot,
  type OperationDefinition,
  type ResultMessage,
} from '@ae-mcp/protocol';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createAEClient, type AEClient } from './ae-client.js';
import { bridgeVersionWarning } from './bridge-version.js';
import { isValidCheckpointName, readCheckpoints, saveCheckpoint } from './checkpoints.js';
import { buildAeContext } from './context.js';
import { dismissFrontDialog, listDialogs } from './dialogs.js';
import {
  compareFrames,
  sipsToBmp,
  type DecodedFrame,
  type FrameComparison,
  type ToBmp,
} from './frame-compare.js';
import {
  contactSheet,
  cropFrame,
  decodeFrameFile,
  encodePng,
  fitSize,
  pngSize,
  scaleFrame,
  type Size,
  type SheetCell,
} from './frame-image.js';
import { DEFAULT_HISTORY_LIST, HistoryLog, MAX_HISTORY_LIST } from './history.js';
import { ANIMATION_GUIDE_URI } from './instructions.js';
import { JobStore } from './jobs.js';
import {
  closestNames,
  defaultOperationRegistry,
  unknownOperationDetails,
  validateOperationArgs,
  type OperationRegistry,
} from './operations.js';
import { selectTransport, type Runner } from './osascript-transport.js';
import { PlanStore } from './plans.js';
import { batchHasDestructive, batchRunBlock, evalRunEnabled, isPermitted } from './policy.js';
import { cleanupPartialOutput } from './render-output.js';
import { batchJson, replayJsx, replaySteps } from './replay.js';
import { loadSettings, type Settings } from './settings.js';
import { runSetupChecks, type SetupDeps } from './setup-checks.js';
import { loadUserSnippets, registerUserSnippets, resolveUserCall, TEMPLATE_OP } from './snippets.js';
import { truncateLongStrings } from './truncate-values.js';

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
  /** MCP `instructions` returned to the client on initialize (a short core of the animation rules). */
  instructions?: string;
  /** Full animation principles, served as the resource ANIMATION_GUIDE_URI (docs/agents/animation-principles.md). */
  guide?: string;
  /** How long `ae_render_frame` waits for AE to finish writing the PNG (test seam). */
  frameWait?: FrameWait;
  /** Compares two rendered frames for `ae_render_frame` `compareWith` (test seam). */
  frameCompare?: (beforePng: string, afterPng: string) => Promise<FrameComparison>;
  /** Scales a rendered PNG so its longest edge is `maxEdge`, returning the new path or null (test seam). */
  resizeFrame?: (file: string, maxEdge: number) => Promise<string | null>;
  /** Converts a rendered PNG to BMP for pixel work (test seam; default macOS `sips`). */
  toBmp?: ToBmp;
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

/** Outcome of a plan step: the value, or the ToolResult to return as the error. */
type PlanOutcome = { ok: true; value: Record<string, unknown> } | { ok: false; result: ToolResult };

function failed(error: unknown): PlanOutcome {
  return { ok: false, result: text(error, true) };
}

/** The JSON error body of a failed ToolResult, for nesting inside another result. */
function errorBody(result: ToolResult): unknown {
  const [first] = result.content;
  return first && first.type === 'text' ? JSON.parse(first.text) : null;
}

/** One finding of project.lint (#244); `fix.safe` findings may be applied with fix: true. */
interface LintFinding {
  item: string;
  rule: string;
  fix?: { safe?: boolean; op?: string; args?: Record<string, unknown> } | null;
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

/** Longest edge of a returned frame when maxEdge is not given (#253; vision-sized, about 0.5 MP). */
export const DEFAULT_RENDER_EDGE = 768;

/** Most frames one contact sheet can hold (ae_render_frame times). */
export const MAX_CONTACT_FRAMES = 36;

/** What the `render.frame` bridge op returns. */
type FrameResult = {
  method?: string;
  comp?: string | null;
  file?: string;
  time?: number;
  frame?: number;
  width?: number;
  height?: number;
};

/** A frame rendered for a region or contact sheet, with its PNG size read from the header. */
type RenderedFrame = {
  file: string;
  time: number;
  frame: number | null;
  method: string | null;
  comp: string | null;
  size: Size | null;
};

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
  maxEdge?: number,
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
  // Downscale when the file is too large to return, or when its longest edge exceeds maxEdge.
  const size = pngSize(buffer);
  const tooWide = maxEdge !== undefined && size !== null && Math.max(size.width, size.height) > maxEdge;
  if ((buffer.length > maxBytes || tooWide) && downscale) {
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
  if (options.guide !== undefined) {
    const guide = options.guide;
    server.registerResource(
      'animation-principles',
      ANIMATION_GUIDE_URI,
      {
        title: 'Animation principles',
        description: 'How to treat keyframes vs expressions, naming, parenting, easing and safety when driving After Effects.',
        mimeType: 'text/markdown',
      },
      async () => ({
        contents: [{ uri: ANIMATION_GUIDE_URI, mimeType: 'text/markdown', text: guide }],
      }),
    );
  }
  // The full hint for each error code, once; errors carry only the short `hint`.
  server.registerResource(
    'error-hints',
    ERROR_HINTS_URI,
    {
      title: 'Error hints',
      description: 'Full hint text for every error code returned by ae-mcp.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        { uri: ERROR_HINTS_URI, mimeType: 'application/json', text: JSON.stringify(errorHintDetails) },
      ],
    }),
  );
  const root = options.root ?? queueRoot();
  const maxResultBytes = options.maxResultBytes ?? MAX_RESULT_BYTES;
  const operations = options.operations ?? defaultOperationRegistry();
  // User snippets and templates from <root>/snippets (#246); invalid files are reported by check_setup.
  const userSnippets = loadUserSnippets(root, operations);
  registerUserSnippets(operations, userSnippets);
  const history = new HistoryLog(root);

  /** Logs one bridge call so history_list and history_undo can name its undo group (#236). */
  const recordHistory = async (
    op: string,
    args: Record<string, unknown>,
    result: ResultMessage,
  ): Promise<void> => {
    await history.append({
      op,
      args,
      mutating: operations.get(op)?.readOnly === false,
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error.message }),
    });
  };

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

  /** Operations the current policy lets this client see (ae_catalog and ae_describe). */
  const visibleOperations = async (category?: string): Promise<OperationDefinition[]> => {
    const settings = await getSettings();
    return operations
      .list(category)
      .filter((definition) => isPermitted(definition, settings) && evalRunEnabled(definition, settings));
  };

  /** Hash of the whole visible catalog, so clients can skip re-listing it (#255). */
  const catalogVersion = async (): Promise<string> =>
    createHash('sha256')
      .update(JSON.stringify(await visibleOperations()))
      .digest('hex')
      .slice(0, 16);

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
        // template.user is answered by the server, not the bridge.
        expectedOperations: operations.names().filter((name) => name !== TEMPLATE_OP),
        snippetProblems: loadUserSnippets(root, operations).problems,
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
        'Report the live connection: active transport, AE and bridge versions, capabilities and busy state.',
      inputSchema: {},
    },
    async () => text({ ...(await buildAeContext(root)), catalogVersion: await catalogVersion() }),
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
        'Report layers of a comp (default: active). Compact: defaults and empty arrays omitted. Options: fields, summary, full. Long strings cut unless full.',
      inputSchema: {
        comp: z.union([z.string(), z.number()]).optional(),
        layers: z.array(z.number()).optional(),
        fields: z.array(z.string()).optional(),
        summary: z.boolean().optional(),
        full: z.boolean().optional(),
      },
    },
    async (args) => {
      const result = await callRaw('ae_layer_info', {
        comp: args.comp,
        layers: args.layers,
        fields: args.fields,
        summary: args.summary,
        full: args.full,
      });
      if (!result.ok) {
        return toResult(result);
      }
      const value = result.result as {
        comp?: string | null;
        layers?: unknown[];
        missing?: unknown[];
      };
      const shaped = args.full ? value.layers ?? [] : truncateLongStrings(value.layers ?? []);
      const capped = capArray(shaped, maxResultBytes);
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
        'List expression-driven properties on the layers of a comp (default: active comp). Pass layer indices to narrow. Strings over 2000 chars are cut (<key>Truncated); full: true keeps them.',
      inputSchema: {
        comp: z.union([z.string(), z.number()]).optional(),
        layers: z.array(z.number()).optional(),
        full: z.boolean().optional(),
      },
    },
    async (args) => {
      const result = await callRaw('ae_expression_report', {
        comp: args.comp,
        layers: args.layers,
      });
      // Long strings are cut in the result below (truncateLongStrings), not by the bridge.
      if (!result.ok) {
        return toResult(result);
      }
      const value = result.result as {
        comp?: string | null;
        layers?: unknown[];
        missing?: unknown[];
      };
      const shaped = args.full ? value.layers ?? [] : truncateLongStrings(value.layers ?? []);
      const capped = capArray(shaped, maxResultBytes);
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
        'Name a restore point: File > Increment and Save, recorded under name (1-64 chars). Reusing a name replaces it. Needs a saved project.',
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
        'Reopen a named checkpoint (destructive). Saves the current state first. Refused in read-only mode.',
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
        'Render frame(s) to PNG (default: active comp, frame 0). maxEdge default 768. times: contact sheet (max 36). region [x,y,w,h]: crop. compareWith: diff. See docs/user-guide.md.',
      inputSchema: {
        comp: z.union([z.string(), z.number()]).optional(),
        time: z.number().optional(),
        times: z.array(z.number()).min(1).max(MAX_CONTACT_FRAMES).optional(),
        region: z
          .tuple([
            z.number().int().min(0),
            z.number().int().min(0),
            z.number().int().positive(),
            z.number().int().positive(),
          ])
          .optional(),
        maxEdge: z.number().int().positive().optional(),
        compareWith: z.string().optional(),
      },
    },
    async (args) => {
      if (args.times !== undefined && args.time !== undefined) {
        return text(makeError('INVALID_ARGS', 'pass time or times, not both'), true);
      }
      if (args.times !== undefined && args.compareWith !== undefined) {
        return text(makeError('INVALID_ARGS', 'compareWith compares one frame; drop times'), true);
      }
      const maxEdge = args.maxEdge ?? DEFAULT_RENDER_EDGE;
      const wait = options.frameWait ?? DEFAULT_FRAME_WAIT;

      // Compares the new frame with compareWith; returns an error result instead when that is invalid.
      const compareNew = async (file: string): Promise<{ compare?: FrameComparison; error?: ToolResult }> => {
        if (args.compareWith === undefined) {
          return {};
        }
        if (!isInsideRenderDir(root, args.compareWith)) {
          return {
            error: text(
              makeError('INVALID_ARGS', `compareWith must be a frame inside the render directory: ${args.compareWith}`),
              true,
            ),
          };
        }
        const before = resolve(args.compareWith);
        const exists = await stat(before).then((info) => info.isFile(), () => false);
        if (!exists) {
          return { error: text(makeError('INVALID_ARGS', `compareWith frame does not exist: ${args.compareWith}`), true) };
        }
        try {
          return { compare: await (options.frameCompare ?? compareFrames)(before, resolve(file)) };
        } catch (error) {
          return {
            error: text(
              makeError('SCRIPT_ERROR', `frame comparison failed: ${error instanceof Error ? error.message : String(error)}`),
              true,
            ),
          };
        }
      };

      if (args.times === undefined && args.region === undefined) {
        // One frame: the PNG from AE, scaled down only when it is larger than maxEdge.
        const result = await callRaw('render.frame', { comp: args.comp, time: args.time });
        if (!result.ok) {
          return toResult(result);
        }
        const value = result.result as FrameResult;
        if (typeof value.file !== 'string') {
          return text(makeError('SCRIPT_ERROR', 'render.frame did not return a file path'), true);
        }
        const read = await readRenderedFrame(
          root,
          value.file,
          MAX_RENDER_BYTES,
          (file) => (options.resizeFrame ?? shrinkPng)(file, maxEdge),
          wait,
          maxEdge,
        );
        if (!read.ok) {
          return text(makeError('SCRIPT_ERROR', read.message), true);
        }
        const compared = await compareNew(value.file);
        if (compared.error) {
          return compared.error;
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
                image: pngSize(Buffer.from(read.data, 'base64')),
                ...(compared.compare !== undefined ? { compare: compared.compare } : {}),
              }),
            },
          ],
        };
      }

      // Region crop and/or contact sheet: every frame is decoded and composed here.
      const times = args.times ?? [args.time ?? 0];
      const frames: RenderedFrame[] = [];
      for (const requested of times) {
        const result = await callRaw('render.frame', { comp: args.comp, time: requested });
        if (!result.ok) {
          return toResult(result);
        }
        const value = result.result as FrameResult;
        if (typeof value.file !== 'string') {
          return text(makeError('SCRIPT_ERROR', 'render.frame did not return a file path'), true);
        }
        const file = resolve(value.file);
        if (!isInsideRenderDir(root, file)) {
          return text(makeError('SCRIPT_ERROR', `refusing to read outside the render directory: ${value.file}`), true);
        }
        const buffer = await waitForCompletePng(file, wait);
        if (!buffer) {
          return text(
            makeError('SCRIPT_ERROR', `rendered frame was not finished writing after ${wait.timeoutMs} ms: ${value.file}`),
            true,
          );
        }
        frames.push({
          file: value.file,
          time: value.time ?? requested,
          frame: value.frame ?? null,
          method: value.method ?? null,
          comp: value.comp ?? null,
          size: pngSize(buffer),
        });
      }
      const first = frames[0]!;
      if (first.size === null) {
        return text(makeError('SCRIPT_ERROR', `rendered frame is not a PNG: ${first.file}`), true);
      }
      const region: [number, number, number, number] = args.region ?? [0, 0, first.size.width, first.size.height];
      const [x, y, w, h] = region;
      if (x + w > first.size.width || y + h > first.size.height) {
        return text(
          makeError(
            'INVALID_ARGS',
            `region [${region.join(', ')}] is outside the ${first.size.width}x${first.size.height} frame`,
          ),
          true,
        );
      }
      const cells: SheetCell[] = [];
      for (const frame of frames) {
        const decoded = await decodeFrameFile(resolve(frame.file), options.toBmp ?? sipsToBmp);
        cells.push({ frame: cropFrame(decoded, x, y, w, h), label: `${frame.time.toFixed(2)}s` });
      }
      let image: DecodedFrame;
      let compared: { compare?: FrameComparison; error?: ToolResult } = {};
      if (args.times === undefined) {
        const fitted = fitSize({ width: w, height: h }, maxEdge);
        image = scaleFrame(cells[0]!.frame, fitted.width, fitted.height);
        compared = await compareNew(first.file);
        if (compared.error) {
          return compared.error;
        }
      } else {
        image = contactSheet(cells, Math.ceil(Math.sqrt(cells.length)), maxEdge);
      }
      const single = args.times === undefined;
      return {
        content: [
          { type: 'image', data: encodePng(image).toString('base64'), mimeType: 'image/png' },
          {
            type: 'text',
            text: JSON.stringify({
              method: first.method,
              comp: first.comp,
              file: single ? first.file : null,
              time: single ? first.time : null,
              frame: single ? first.frame : null,
              width: first.size.width,
              height: first.size.height,
              region,
              image: { width: image.width, height: image.height },
              ...(single ? {} : { cells: frames.map((frame) => ({ time: frame.time, frame: frame.frame, file: frame.file })) }),
              ...(compared.compare !== undefined ? { compare: compared.compare } : {}),
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
        'Start an aerender render of a comp or render-queue item as a background job; returns jobId. Poll with job_status.',
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
        "List modal dialogs open in After Effects, or dismiss the frontmost (Cancel or Escape, never Save). A dialog blocks other tools. Needs Accessibility.",
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
        'Cancel a background job, stop its aerender and remove partial output. Returns the final job record.',
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
    'history_list',
    {
      description:
        "Last n ops Claude ran (newest first): op, args, time, undo group, ok. Read-only.",
      inputSchema: {
        n: z.number().int().positive().max(MAX_HISTORY_LIST).optional(),
      },
    },
    async (args) => text({ entries: await history.list(args.n ?? DEFAULT_HISTORY_LIST) }),
  );

  server.registerTool(
    'history_undo',
    {
      description:
        "Names the undo steps for Claude's last n edits and how many Cmd+Z presses revert them. Never undoes by script (ADR-0009).",
      inputSchema: {
        n: z.number().int().positive().max(MAX_HISTORY_LIST).default(1),
      },
    },
    async (args) => {
      const groups = await history.undoGroups(args.n);
      if (groups === null) {
        return text(
          makeError(
            'INVALID_ARGS',
            `the history holds fewer than ${args.n} mutating operations by Claude`,
          ),
          true,
        );
      }
      return text({
        undoGroups: groups,
        pressCmdZ: groups.length,
        instruction: `Press Cmd+Z ${groups.length} time(s) in After Effects (Edit > Undo). Claude cannot undo by script.`,
        warning:
          "AE's undo stack cannot be inspected by script. Any edit the user made after these steps is undone first, so check the Edit menu's undo label before pressing.",
      });
    },
  );

  server.registerTool(
    'history_export',
    {
      description:
        "Export Claude's steps as a replay: 'batch' (batch.run args) or 'jsx' (standalone script). comp retargets steps. Default path ~/.ae-mcp/replays/.",
      inputSchema: {
        format: z.enum(['batch', 'jsx']).default('batch'),
        n: z.number().int().positive().max(MAX_HISTORY_LIST).optional(),
        comp: z.string().optional(),
        path: z.string().optional(),
      },
    },
    async (args) => {
      const all = await history.all();
      const entries = args.n === undefined ? all : all.slice(-args.n);
      if (entries.length === 0) {
        return text(makeError('INVALID_ARGS', 'the history is empty: nothing to export'), true);
      }
      const plan = replaySteps(entries, operations, args.comp);
      if (plan.ops.length === 0) {
        return text(
          makeError('INVALID_ARGS', 'the history has no steps that can be replayed (only read-only or failed calls)'),
          true,
        );
      }
      const exportedAt = new Date().toISOString();
      let content: string;
      if (args.format === 'jsx') {
        const payloadPath = join(root, 'bridge', 'current.jsx');
        let payload: string;
        try {
          payload = await readFile(payloadPath, 'utf8');
        } catch {
          return text(
            makeError('SCRIPT_ERROR', `no installed bridge payload at ${payloadPath}; run the Setup app to install it`),
            true,
          );
        }
        content = replayJsx(plan, payload, args.comp ?? null, exportedAt);
      } else {
        content = batchJson(plan);
      }
      const file =
        args.path ??
        join(root, 'replays', `replay-${exportedAt.replace(/[:.]/g, '-')}.${args.format === 'jsx' ? 'jsx' : 'json'}`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
      return text({
        format: args.format,
        path: file,
        steps: plan.ops.length,
        skipped: plan.skipped,
        ...(args.format === 'batch' ? { batch: { ops: plan.ops } } : {}),
      });
    },
  );

  server.registerTool(
    'ae_catalog',
    {
      description:
        'List operations available through ae_do: name and description. Filter by category. Use ae_describe for one schema.',
      inputSchema: {
        category: z.string().optional(),
        verbose: z.boolean().optional(),
        ifNoneMatch: z.string().optional(),
      },
    },
    async (args) => {
      const version = await catalogVersion();
      if (args.ifNoneMatch !== undefined && args.ifNoneMatch === version) {
        return text({ unchanged: true, version });
      }
      const allowed = await visibleOperations(args.category);
      if (args.verbose === true) {
        return text({ operations: allowed, version });
      }
      return text({
        operations: allowed.map((definition) => ({
          name: definition.name,
          description: definition.description,
        })),
        version,
      });
    },
  );

  server.registerTool(
    'ae_describe',
    {
      description:
        'Show one ae_do operation: its full schema and required arguments. Call it before ae_do with an unfamiliar op.',
      inputSchema: {
        op: z.string(),
      },
    },
    async (args) => {
      const settings = await getSettings();
      const visible = operations
        .list()
        .filter((definition) => isPermitted(definition, settings) && evalRunEnabled(definition, settings));
      const definition = visible.find((entry) => entry.name === args.op);
      if (definition === undefined) {
        // Hidden operations are reported as unknown, the same as ae_catalog does.
        const suggestions = closestNames(
          visible.map((entry) => entry.name),
          args.op,
        );
        const suffix = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
        return text(makeError('INVALID_ARGS', `unknown operation '${args.op}'.${suffix}`), true);
      }
      return text(definition);
    },
  );

  server.registerTool(
    'ae_do',
    {
      description:
        'Run a named operation from ae_catalog. Args are validated against its schema first. Call get_selection for the active comp and selection. Long strings are cut unless full: true.',
      inputSchema: {
        op: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
        full: z.boolean().optional(),
      },
    },
    async (incoming) => {
      const resolved = resolveUserCall(incoming.op, incoming.args, userSnippets);
      if (!resolved.ok) {
        return text(makeError('INVALID_ARGS', resolved.message), true);
      }
      const toolArgs = { op: resolved.op, args: resolved.args, full: incoming.full };
      const definition = operations.get(toolArgs.op);
      if (definition === undefined) {
        const suggestions = closestNames(operations.names(), toolArgs.op);
        const suffix = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
        return text(
          makeError('UNKNOWN_TOOL', `unknown operation '${toolArgs.op}'.${suffix}`, unknownOperationDetails(operations.names(), toolArgs.op)),
          true,
        );
      }
      const validation = validateOperationArgs(definition.schema, toolArgs.args, definition.required);
      if (!validation.ok) {
        return text(makeError('INVALID_ARGS', validation.message, validation.details), true);
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
        return text(makeError(blocked.code, blocked.message, blocked.details), true);
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
      await recordHistory(definition.name, validation.args, result);
      if (definition.name === 'project.lint' && validation.args.fix === true && result.ok) {
        // fix: true applies only the findings marked safe, through the plan store (#244).
        return text({ result: result.result, fixes: await applyLintFixes(result.result) });
      }
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
      const readsValues = definition.name === 'property.get' || definition.name === 'text.read';
      const payload: Record<string, unknown> = {
        result: readsValues && toolArgs.full !== true ? truncateLongStrings(result.result) : result.result,
      };
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

  /** Previews a bulk operation and registers it as a plan (the body of ae_plan; reused by project.lint fixes, #244). */
  const planOperation = async (op: string, argsIn: Record<string, unknown> | undefined): Promise<PlanOutcome> => {
    const definition = operations.get(op);
    if (definition === undefined) {
      const suggestions = closestNames(operations.names(), op);
      const suffix = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
      return failed(makeError('UNKNOWN_TOOL', `unknown operation '${op}'.${suffix}`, unknownOperationDetails(operations.names(), op)));
    }
    if (definition.category !== 'bulk') {
      return failed(makeError('INVALID_ARGS', `operation '${op}' is not a bulk operation`));
    }
    const validation = validateOperationArgs(definition.schema, argsIn, definition.required);
    if (!validation.ok) {
      return failed(makeError('INVALID_ARGS', validation.message, validation.details));
    }
    const settings = await getSettings();
    if (!isPermitted(definition, settings)) {
      return failed(makeError('FORBIDDEN', `operation '${op}' is not permitted by the current policy`));
    }
    const dry = await callRaw(definition.name, { ...validation.args, dryRun: true });
    if (!dry.ok) {
      return { ok: false, result: toResult(dry) };
    }
    const value = dry.result as { changes?: unknown[]; fingerprint?: unknown } | null;
    if (typeof value?.fingerprint !== 'string') {
      return failed(makeError('SCRIPT_ERROR', `operation '${op}' did not return a plan fingerprint`));
    }
    const planId = planStore.create([{ op: definition.name, args: validation.args }], value.fingerprint);
    return { ok: true, value: { planId, changes: value.changes ?? [] } };
  };

  /** Applies a registered plan (the body of ae_apply; reused by project.lint fixes, #244). */
  const applyPlan = async (planId: string): Promise<PlanOutcome> => {
    const peeked = planStore.peek(planId);
    if (peeked === undefined) {
      return failed(makeError('UNKNOWN_PLAN', `no plan with id '${planId}'`));
    }
    const step = peeked.steps[0];
    if (step === undefined) {
      return failed(makeError('SCRIPT_ERROR', `plan '${planId}' has no steps`));
    }
    if (operations.get(step.op) === undefined) {
      return failed(makeError('UNKNOWN_TOOL', `plan references unknown operation '${step.op}'`));
    }
    const dry = await callRaw(step.op, { ...step.args, dryRun: true });
    if (!dry.ok) {
      return { ok: false, result: toResult(dry) };
    }
    const current = (dry.result as { fingerprint?: unknown } | null)?.fingerprint;
    const taken = planStore.take(planId, typeof current === 'string' ? current : '');
    if (!taken.ok) {
      if (taken.reason === 'expired') {
        return failed(makeError('PLAN_EXPIRED', `plan '${planId}' has expired`));
      }
      if (taken.reason === 'changed') {
        return failed(makeError('PLAN_CHANGED', 'the project changed since the plan was made'));
      }
      return failed(makeError('UNKNOWN_PLAN', `no plan with id '${planId}'`));
    }

    const stepDefinition = operations.get(step.op);
    const settings = await getSettings();
    const needsIncrement = stepDefinition?.destructive === true && settings.incrementBeforeDestructive;
    let incrementInfo: Record<string, unknown> | null = null;
    if (needsIncrement) {
      const increment = await incrementBeforeDestructive(step.op);
      if (!increment.ok) {
        return { ok: false, result: increment.result };
      }
      incrementInfo = increment.info;
    }

    const result = await callRaw(step.op, { ...step.args, dryRun: false });
    await recordHistory(step.op, step.args, result);
    if (!result.ok) {
      return { ok: false, result: toResult(result) };
    }
    const payload: Record<string, unknown> = { planId, op: step.op, result: result.result };
    if (incrementInfo) {
      payload.increment = incrementInfo;
    }
    return { ok: true, value: payload };
  };

  /**
   * Applies the findings of project.lint whose fix is marked safe: each one is planned with
   * ae_plan's logic and applied with ae_apply's, so the fingerprint check still guards it (#244).
   */
  const applyLintFixes = async (report: unknown): Promise<Array<Record<string, unknown>>> => {
    const findings = (report as { findings?: LintFinding[] } | null)?.findings ?? [];
    const outcomes: Array<Record<string, unknown>> = [];
    for (const finding of findings) {
      if (finding.fix?.safe !== true || finding.fix.op === undefined) {
        continue;
      }
      const planned = await planOperation(finding.fix.op, finding.fix.args);
      if (!planned.ok) {
        outcomes.push({ item: finding.item, rule: finding.rule, applied: false, error: errorBody(planned.result) });
        continue;
      }
      const applied = await applyPlan(planned.value.planId as string);
      outcomes.push(
        applied.ok
          ? { item: finding.item, rule: finding.rule, applied: true, result: applied.value }
          : { item: finding.item, rule: finding.rule, applied: false, error: errorBody(applied.result) },
      );
    }
    return outcomes;
  };

  server.registerTool(
    'ae_plan',
    {
      description:
        'Preview a bulk operation as a plan without changing the project. Returns {planId, changes}. Apply with ae_apply.',
      inputSchema: {
        op: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (toolArgs) => {
      const planned = await planOperation(toolArgs.op, toolArgs.args);
      return planned.ok ? text(planned.value) : planned.result;
    },
  );

  server.registerTool(
    'ae_apply',
    {
      description:
        'Apply a plan from ae_plan as one undo group. Refuses expired plans and plans made before the project changed.',
      inputSchema: {
        planId: z.string(),
      },
    },
    async (toolArgs) => {
      const applied = await applyPlan(toolArgs.planId);
      return applied.ok ? text(applied.value) : applied.result;
    },
  );

  return server;
}
