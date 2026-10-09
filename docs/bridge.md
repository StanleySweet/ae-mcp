# Bridge

The bridge is After Effects-side ExtendScript (ES3) that executes MCP tool calls
against the open AE project. It is built from `packages/bridge/src` into two
artifacts in `packages/bridge/dist` (see `npm run bridge:build`):

- `loader.jsx` — installed into the AE `Scripts/Startup` folder; survives the
  session, sends heartbeats, re-loads the payload when its version changes, and
  polls the inbox for jobs (transport A fallback).
- `payload.jsx` — the idempotent runtime (polyfills, JSON, queue-root helpers,
  and the job runner); deployed to `~/.ae-mcp/bridge/current.jsx`. Both bundles
  share `bridge-fs.js` (queue root, directory/file helpers).

## Queue-root files

The bridge uses the same queue layout as the protocol (`AE_MCP_ROOT`, default
`$HOME/.ae-mcp`, see BE `packages/protocol/src/queue.ts`). Additional files:

| Path (under queue root)            | Writer  | Meaning                                   |
|------------------------------------|---------|-------------------------------------------|
| `bridge/inbox/`                    | server  | job files `<id>.json`                     |
| `bridge/outbox/`                   | bridge  | result files `<id>.json`                  |
| `bridge/outbox/heartbeat.json`     | bridge  | latest heartbeat (overwritten each beat)  |
| `bridge/current.jsx`               | server  | current payload, read by the loader       |
| `bridge/.payload-version`          | bridge  | last-evaluated payload version            |

## Loader behavior

On AE startup the loader:

1. Ensures the queue directories exist.
2. Reads `bridge/current.jsx`. If its stamped `AEMCP_BRIDGE_VERSION` differs
   from `bridge/.payload-version`, it `$.evalFile`-loads the payload and updates
   the marker. `bridgeVersion` of `"none"` is reported when the payload is
   missing, and the payload is re-checked on every beat.
3. Writes `bridge/outbox/heartbeat.json`, a valid `HeartbeatMessage` (protocol
   version 1) with `capabilities: []`, `busy: false` and
   `transport: 'startup-loader'` — every 30 s.
4. Polls `bridge/inbox/*.json` every 200 ms (transport A fallback), running each
   job through the payload's job runner.

The job runner (`AEMCP` in the payload) exposes `processJob(path)`,
`invoke(tool, args, deadline)`, and `poll(root)` for transport B to drive with
`DoScriptFile`. Each job:

- runs inside one undo group named `ae-mcp <tool>`;
- always writes a result to `bridge/outbox/<id>.json` — `ok: true` with the
  handler value (`null` for undefined), or `ok: false` with `INVALID_MESSAGE`,
  `UNKNOWN_TOOL`, `TIMEOUT` (via `job.deadline`), or `SCRIPT_ERROR` (handler
  throw) and the canonical hint;
- consumes the job file.

`capabilities` is populated by the handler registry (E3-7); `busy` and chunked
execution come from E3-8.