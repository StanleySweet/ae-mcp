# Code Map

Architecture map for agents: where the pieces live and the patterns to follow. Read this before exploring. Update when code changes. `CONTEXT.md` (glossary) and ADRs are separate — see `domain.md`.

## Server tools (`packages/server/src/server.ts`)

- `createServer(options)` :91 — every tool is `server.registerTool(name, config, handler)`.
  - `inputSchema` is a zod raw shape; the MCP SDK validates args against it before the handler runs (`InvalidParams` on failure).
- Existing tools: `check_setup` :188, `ae_context` :204, `ae_project_info` :214, `ae_comp_info` :224, `ae_layer_info` :248, `ae_version_info` :281, `get_selection` :291, `find` :301, `ae_render_frame` :332, `ae_render` :386, `job_status` :446, `ae_catalog` :464, `ae_do` :482.
- Helpers: `text(value, isError?)` :44 (JSON.stringify → MCP text content), `toResult(ResultMessage)` :48 (ok → text, else text+`isError:true`), `readRenderedFrame(root, file, maxBytes)` :53 (reads a frame the bridge rendered, refusing paths outside `<root>/render`, base64 → image data; `MAX_RENDER_BYTES` 20_000_000 :22), `callRaw(tool, args)` :116 (lazy memoized `AEClient.call`), `capArray` :76 (byte cap `MAX_RESULT_BYTES` 200_000, sets `truncated`).
- `ae_render_frame` (E8-2) runs `render.frame` then returns MCP `image` content (`mimeType: image/png`) plus a JSON metadata text block.
- `ae_render` (E8-5) starts an aerender render as a background job and returns `{jobId}`; `job_status` (E8-5) polls it. `findAerender` :137 uses `options.aerender` or `discoverAerenders(applicationsDir)`, `resolveProject` :146 defaults to the open project's file (from `ae_project_info`) and refuses an unsaved project (`UNSAVED_PROJECT`). See the job store below.
- `ServerOptions` :25 injects `root`, `client`, `operations`, `maxResultBytes`, `settings`, and (E8-5) `aerender`, `spawnAerender`, `jobStore` — used by tests.
- `getSettings()` :79 — lazy `loadSettings({root})`, or `Promise.resolve(options.settings)` when injected.
- Policy (E7-2): `isPermitted(def, settings)` + `batchRunBlock(registry, ops, settings)` `server/src/policy.ts:4,11`. `ae_do` and `ae_catalog` enforce it: read-only hides non-`readOnly` ops, `allowedCategories` filters by category, `batch.run` is checked per sub-op. Rejection uses error code `FORBIDDEN` (added in `protocol/src/errors.ts`).
- eval gate (E7-3): `evalRunEnabled(def, settings)` `policy.ts:24` — `eval.run` is hidden from `ae_catalog` and rejected by `ae_do` (FORBIDDEN) unless `settings.evalEnabled`.
- destructive guard (E13-3/4): in `ae_do` `server.ts:301` — a `destructive` op (or a `batch.run` containing one, via `batchHasDestructive` `policy.ts:60`) first runs `project.increment_save`; a project that has never been saved is refused with error code `UNSAVED_PROJECT`. One increment per call / per `batch.run`. Gated by `settings.incrementBeforeDestructive` (default on, env `AE_MCP_INCREMENT_BEFORE_DESTRUCTIVE`).

## Operations registry

- Type: `packages/protocol/src/operations.ts` — `operationCategories` :3, `operationDefinitionSchema` :26 `{name, category, description, readOnly, destructive, schema}` (`schema` is free-form JSON-Schema-shaped record, never converted to zod; `destructive` is a required flag, E13-1). Exported `protocol/src/index.ts:21`.
- Registry: `packages/server/src/operations.ts` — `OperationRegistry` :3 (`register/get/names/list`), `defaultOperationRegistry()` :138 registers every bridge operation (E6-16, ~64 ops: project/comp/layer/property/keyframe/expression/effect/preset/marker/mask/shape/text/audio/render/font/command/batch) with category, description, `readOnly`, `destructive` (§E13: delete/remove, `command.execute` and `render.queue_start`) and per-handler arg schemas.
- `ae_do` validation/recall helpers in `operations.ts`: `validateOperationArgs(schema, args)` :43 (JSON-Schema-shaped property map: type + enum, rejects unknown keys) and `closestNames(names, query)` :88 (Levenshtein). `ae_do` runs op via `callRaw(definition.name, args)`, then appends `get_selection` as `context`; unknown op → `UNKNOWN_TOOL` with closest names, bad args → `INVALID_ARGS`, both without touching AE.
- `ae_catalog` returns `operations.list(category?)`; policy filtering arrives in E7-2.

## Bridge call path

- `AEClient.call(tool, args)` `ae-client.ts:26`; builds job `{protocolVersion:1, id, tool, args, deadline}` :72 (30s timeout :57). Transport failure → `BRIDGE_NOT_LOADED` :103; stall detection rewrites timeouts into a modal-dialog hint.
- `ResultMessage` `protocol/src/messages.ts:24-41`: `{ok:true,result}` | `{ok:false,error:{code,message,hint?}}`. Codes+hints `protocol/src/errors.ts:3-32` (`makeError`).
- **`job.tool` IS the operation name** — bridge treats observe tools and `category.action` op names identically.

## Bridge runtime (`packages/bridge`, ES3 `.js`, concatenated)

- `job-runner.js`: `aemcpInvoke(tool,args,deadline)` :30 (handler lookup :34, `UNKNOWN_TOOL` :36, one undo group `'Claude: '+tool` :38, `SCRIPT_ERROR` :51), `aemcpProcessJob` :59, `aemcpRegister` :111, `AEMCP.capabilities()` :124.
- Handlers: `handlers.js` `AEMCP.register(...)` :3,22,56,84,92,151; active-comp resolve `aemcpResolveComp` :47. E7-5 `project.export_json` uses `AEMCP.serialize.projectSnapshot` (item tree + comp layers snapshot, `format: 'aemcp-project/v1'`). E8-1 `render.frame` saves one PNG via `CompItem.saveFrameToPng`, falling back to the render queue + PNG output module; output defaults to `<queue root>/render/<comp>-<frame>.png`. E8-3 render-queue ops: `render.queue_add` (`RQueue.items.add` + time span), `render.queue_set_output` (`OutputModule.file`/`applyTemplate`), `render.queue_start` (`RenderQueue.render()`, destructive) and `render.status`; helpers `aemcpRequireRqItem`, `aemcpRenderItemInfo`, `aemcpRqStatusName`.
- Build: `bridge/src/build.ts` prepends polyfills + `job-runner.js` + `serializers.js` + `handlers.js`.

## Job store (`packages/server/src/jobs.ts`, E8-5)

- `JobStore` — in-memory registry of long-running jobs (`JobRecord {id, kind, status, createdAt, finishedAt?, progress?, error?, result?}`; `JobStatus = running|succeeded|failed|cancelled`). `start(kind)` → id, `get`/`list` (return copies), `progress(id, {frame, rendered, seconds})`, `succeed`/`fail`/`cancel`; finished jobs are evicted past `maxFinished` (default 50). Consumers: `ae_render` + `job_status`.

## Core (`packages/core`, macOS install + aerender)

- `discoverAEVersions(dir)` `ae-discovery.ts` + `MIN_SUPPORTED_AE_YEAR` — finds AE installs (folder layout `/Applications/Adobe After Effects <year>/…app`, or a bare `.app`), newest first; `AEInstall = {appName, year, path}`.
- `discoverAerender(install)` / `discoverAerenders(dir?)` `aerender-discovery.ts` (E8-4) — aerender ships in the version folder next to the `.app`, checked before the in-bundle `Contents/Resources` fallback; `AerenderInstall = AEInstall & {aerender}`.
- `parseAerenderLine(line)` `aerender-progress.ts` (E8-4) — one stdout/stderr line → `AerenderEvent` (`version`/`launching`/`progress {frame,rendered,seconds}`/`error`) or null.
- `buildAerenderArgs(options)` / `runAerender(options)` `aerender-runner.ts` (E8-4) — builds `-project/-comp/-rqindex/-RStemplate/-OMtemplate/-output/-s/-e/-i/-reuse/-v/-close` and spawns aerender, streaming lines and parsed events; returns `{result, cancel}`, cancelled by the handle or an `AbortSignal`. `spawn` is injectable (test seam); default uses `node:child_process.spawn`.

## Settings (`packages/server/src/settings.ts`)

- `loadSettings({root, env})` :42 — reads `~/.ae-mcp/settings.json` (zod-validated, unknown keys rejected), env vars (`AE_MCP_READ_ONLY`, `AE_MCP_ALLOWED_CATEGORIES`, `AE_MCP_EVAL_ENABLED`, `AE_MCP_INCREMENT_BEFORE_DESTRUCTIVE`) override the file. Defaults in `DEFAULT_SETTINGS` :18. Consumed by the E7 policy engine.

## Ambient connection context

- `buildAeContext(root, {now, maxAgeMs})` `server/src/context.ts:20` — heartbeat-derived connection state (used by `ae_context`), NOT comp/selection.
- Active comp + selection come from a `get_selection` bridge call (fake impl `fake-bridge/src/handlers.ts:123`).

## Fake bridge & tests

- `observeHandlers(project): HandlerMap` `fake-bridge/src/handlers.ts:60`; `createQueueConsumer(root, handlers)` `fake-bridge/src/consumer.ts`; `HandlerMap = Record<string, (args)=>unknown>`.
- Full-stack tool test pattern: `layer-info.test.ts:13-54` — start consumer, `createAEClient` over `FileQueueTransport`, `createServer({client})`, connect via `InMemoryTransport.createLinkedPair`, call, `JSON.parse(content[0].text)`, zod-parse.
- Registry-only test pattern: `catalog.test.ts:22-38` — `createServer({operations})`, no bridge.
- Contract suite (any bridge): `protocol/src/contract-suite.ts:25-83`.
