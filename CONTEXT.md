# CONTEXT

Living map of the ae-mcp project: what it is, how it is wired, and the vocabulary
the rest of the docs use. Rewritten in place as state changes; history lives in
`JOURNAL.md` and `docs/`.

## What this is

After Effects for Claude — an MCP server that lets Claude Desktop see and edit the
After Effects project the user has open. macOS only.

v1.0.0 is released: pushing a `v*` tag runs `release.yml`, which publishes the
`.mcpb`, the Setup app for arm64 and x64, and `SHA256SUMS.txt`.

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
  evals the payload into AE. Optional for the running MCP (transport B works
  without it, ADR 0004) but the gating step of a complete, verified Setup install:
  Setup writes it first and aborts rather than half-installing (ADR 0005).
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
- **match name** — AE's locale-stable identifier for a property/group/effect
  (`ADBE Opacity`), as opposed to its localized display `name` (`Opacité`). Bridge
  lookups target match names (BACKLOG §2 rule 11).

## Pointers

- Spec: `docs/BACKLOG.md` (section 2 = rules for executing LLMs).
- Code map: `docs/agents/code-map.md`.
- Decisions: `docs/decisions/`.
- Progress log: `JOURNAL.md`.
