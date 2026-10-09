# Bridge

The bridge is After Effects-side ExtendScript (ES3) that executes MCP tool calls
against the open AE project. It is built from `packages/bridge/src` into two
artifacts in `packages/bridge/dist` (see `npm run bridge:build`):

- `loader.jsx` — installed into the AE `Scripts/Startup` folder; survives the
  session, sends heartbeats, and re-loads the payload when its version changes.
- `payload.jsx` — the idempotent runtime (polyfills, JSON, and later the job
  runner); deployed to `~/.ae-mcp/bridge/current.jsx`.

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

On AE startup (and every 30 s thereafter) the loader:

1. Ensures the queue directories exist.
2. Reads `bridge/current.jsx`. If its stamped `AEMCP_BRIDGE_VERSION` differs
   from `bridge/.payload-version`, it `$.evalFile`-loads the payload and updates
   the marker. `bridgeVersion` of `"none"` is reported when the payload is
   missing.
3. Writes `bridge/outbox/heartbeat.json`, a valid `HeartbeatMessage` (protocol
   version 1) with `capabilities: []`, `busy: false` and
   `transport: 'startup-loader'`.

`capabilities` is populated by the handler registry (E3-7); `busy` and chunked
execution come from E3-8.