# Code Map

Architecture map for agents: where the pieces live and the patterns to follow. Read this before exploring. Update when code changes. `CONTEXT.md` (glossary) and ADRs are separate — see `domain.md`.

## Server tools (`packages/server/src/server.ts`)

- `createServer(options)` :56 — every tool is `server.registerTool(name, config, handler)`.
  - `inputSchema` is a zod raw shape; the MCP SDK validates args against it before the handler runs (`InvalidParams` on failure).
- Existing tools: `check_setup` :80, `ae_context` :96, `ae_project_info` :106, `ae_comp_info` :116, `ae_layer_info` :140, `ae_version_info` :173, `get_selection` :183, `find` :193, `ae_catalog` :224, `ae_do` :236.
- Helpers: `text(value, isError?)` :32 (JSON.stringify → MCP text content), `toResult(ResultMessage)` :36 (ok → text, else text+`isError:true`), `callRaw(tool, args)` :75 (lazy memoized `AEClient.call`), `capArray` :41 (byte cap `MAX_RESULT_BYTES` 200_000, sets `truncated`).
- `ServerOptions` :17-25 injects `root`, `client`, `operations`, `maxResultBytes` — used by tests.

## Operations registry

- Type: `packages/protocol/src/operations.ts` — `operationCategories` :3, `operationDefinitionSchema` :26 `{name, category, description, readOnly, schema}` (`schema` is free-form JSON-Schema-shaped record, never converted to zod). Exported `protocol/src/index.ts:21`.
- Registry: `packages/server/src/operations.ts` — `OperationRegistry` :3 (`register/get/names/list`), `defaultOperationRegistry()` :25 is EMPTY. E6-5..15 register the real ops.
- `ae_do` validation/recall helpers in `operations.ts`: `validateOperationArgs(schema, args)` :43 (JSON-Schema-shaped property map: type + enum, rejects unknown keys) and `closestNames(names, query)` :88 (Levenshtein). `ae_do` runs op via `callRaw(definition.name, args)`, then appends `get_selection` as `context`; unknown op → `UNKNOWN_TOOL` with closest names, bad args → `INVALID_ARGS`, both without touching AE.
- `ae_catalog` returns `operations.list(category?)`; policy filtering arrives in E7-2.

## Bridge call path

- `AEClient.call(tool, args)` `ae-client.ts:26`; builds job `{protocolVersion:1, id, tool, args, deadline}` :72 (30s timeout :57). Transport failure → `BRIDGE_NOT_LOADED` :103; stall detection rewrites timeouts into a modal-dialog hint.
- `ResultMessage` `protocol/src/messages.ts:24-41`: `{ok:true,result}` | `{ok:false,error:{code,message,hint?}}`. Codes+hints `protocol/src/errors.ts:3-32` (`makeError`).
- **`job.tool` IS the operation name** — bridge treats observe tools and `category.action` op names identically.

## Bridge runtime (`packages/bridge`, ES3 `.js`, concatenated)

- `job-runner.js`: `aemcpInvoke(tool,args,deadline)` :30 (handler lookup :34, `UNKNOWN_TOOL` :36, one undo group `'Claude: '+tool` :38, `SCRIPT_ERROR` :51), `aemcpProcessJob` :59, `aemcpRegister` :111, `AEMCP.capabilities()` :124.
- Handlers: `handlers.js` `AEMCP.register(...)` :3,22,56,84,92,151; active-comp resolve `aemcpResolveComp` :47.
- Build: `bridge/src/build.ts` prepends polyfills + `job-runner.js` + `serializers.js` + `handlers.js`.

## Ambient connection context

- `buildAeContext(root, {now, maxAgeMs})` `server/src/context.ts:20` — heartbeat-derived connection state (used by `ae_context`), NOT comp/selection.
- Active comp + selection come from a `get_selection` bridge call (fake impl `fake-bridge/src/handlers.ts:123`).

## Fake bridge & tests

- `observeHandlers(project): HandlerMap` `fake-bridge/src/handlers.ts:60`; `createQueueConsumer(root, handlers)` `fake-bridge/src/consumer.ts`; `HandlerMap = Record<string, (args)=>unknown>`.
- Full-stack tool test pattern: `layer-info.test.ts:13-54` — start consumer, `createAEClient` over `FileQueueTransport`, `createServer({client})`, connect via `InMemoryTransport.createLinkedPair`, call, `JSON.parse(content[0].text)`, zod-parse.
- Registry-only test pattern: `catalog.test.ts:22-38` — `createServer({operations})`, no bridge.
- Contract suite (any bridge): `protocol/src/contract-suite.ts:25-83`.
