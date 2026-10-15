# CONTEXT

Living map of the ae-mcp project: what it is, how it is wired, and the vocabulary
the rest of the docs use. Rewritten in place as state changes; history lives in
`JOURNAL.md` and `docs/`.

## What this is

After Effects for Claude — an MCP server that lets Claude Desktop see and edit the
After Effects project the user has open. macOS only.

## Shape

- `packages/server` — the MCP server. Registers the tools (`ae_do`, `ae_plan`,
  `ae_apply`, `ae_render`, `ae_catalog`, `ae_project_info`, …), validates
  arguments, and reaches AE.
- `packages/bridge` — ExtendScript (ES3) that runs inside After Effects. Receives
  operations and mutates the project.
- `packages/protocol` — shared message and error types.
- `packages/core` — macOS AE discovery (installs, CEP extensions) and the
  `aerender` process helpers.
- `apps/installer` — the **AE-MCP Setup** native macOS app (Avalonia / C#):
  detect → repair. Ships the `.mcpb` and the bridge inside its own bundle; no
  Node runs inside the app.

## Vocabulary

- **payload** — the bridge implementation, `~/.ae-mcp/bridge/current.jsx`.
- **loader** — the Startup script (`…/Scripts/Startup/ae-mcp-loader.jsx`) that
  evals the payload into AE. Optional (ADR 0004): transport B works without it;
  it adds the startup heartbeat and the transport-A fallback.
- **transport** — how the server reaches AE: `osascript` (ADR 0001 option B,
  primary) or the file-queue (option A, fallback).
- **operation** — a named action (`comp.create`, `keyframe.add`, …) in the bridge
  catalog; `ae_catalog` lists them, `ae_do` runs one.
- **tool** — an MCP tool the server exposes to Claude; each maps to operations.
- **plan / apply** — `ae_plan` previews a bulk operation and registers it;
  `ae_apply` runs it as one undo group.
- **destructive guard** — operations flagged `destructive` first run
  `project.increment_save`, so a change is saved to a new file before it happens.
- **increment_save** — Save-As to `…_vNNN.aep`.
- **job** — a background `aerender` render (`ae_render` → `job_status`).
- **comp / layer / property** — an After Effects composition, layer, and animatable
  property.
- **mock** — `packages/bridge/src/mock-ae.ts`: a fake AE that lets the bridge run
  under Node for tests.

## Pointers

- Spec: `docs/BACKLOG.md` (section 2 = rules for executing LLMs).
- Code map: `docs/agents/code-map.md`.
- Decisions: `docs/decisions/`.
- Progress log: `JOURNAL.md`.
