# ADR-0003: Native (Avalonia/C#) installer instead of Electron

Date: 2026-10-15
Status: Accepted
Decider: Stan (owner)
Authors: Stan (owner)
References:
- `docs/superpowers/specs/2026-10-15-native-installer-design.md` (full design, commit `58203a2`)
- ADR-0001 (transport B, osascript) — the Setup app's live test uses it
- `packages/protocol/contract/` (shared job/result fixtures)

## Context

The **AE-MCP Setup** app was an Electron + TypeScript app in `apps/installer`:
`main`/`preload`/`renderer` processes over IPC, bundling `@ae-mcp/core` and
`@ae-mcp/server/bridge` from TypeScript source with esbuild, then `electron-builder`
into an unsigned mac dmg. It shipped a Node runtime, an asar bundle and
`node_modules` churn, and the renderer's plain markup had been called "ugly".

Its only unique job was installer orchestration (detect AE/Claude, install the
bridge payload + startup loader, enable the scripting pref, hand over the `.mcpb`,
run a live test, uninstall, export diagnostics) — logic that already lived in
`packages/core` and could be expressed in any language.

## Decision

Rewrite Setup as a **native macOS app in C# on Avalonia** (`apps/installer/AeMcpSetup*`,
`net10.0`), with the installer logic **ported one-to-one** to `AeMcpSetup.Core`.
The GUI is a straight port: the same 6 rows and actions, a cleaner single-column
UI. Publish **self-contained + trimmed** (`PublishTrimmed`). After the port, the
Electron app and the now-dead `packages/core` installer modules are deleted.

Two small pieces stay duplicated on purpose: `AeDiscovery` and `AeExtensions`
exist in both C# and TS because the **MCP server** still uses the TS copies.
The bridge job/result JSON is encoded independently in C#; a shared fixture
(`packages/protocol/contract/`) is asserted by both a C# and a TS test to catch drift.

## Consequences

- No Node runtime, asar or `node_modules` inside Setup; smaller, faster app.
- The installer logic exists in two languages during the port and, for
  `ae-discovery`/`ae-extensions`, afterwards.
- Two build toolchains: `npm` (server/bridge/bundle) and `dotnet` (Setup). `check`
  gains `dotnet test`; CI/release add `actions/setup-dotnet`.
- Trimming is a new runtime risk (reflection); mitigated by keeping reflection
  serialization enabled for the small, well-known JSON shapes and by exercising
  the trimmed bundle.
- `packages/server/src/bridge.ts` (`createBridgeCall`, the former installer's
  entry point) is left in place but currently unused — removing it is a change to
  the server package, which this work keeps out of scope.

## Alternatives considered

- **Keep Electron, fix the UI** — cheapest, but keeps Node in the app and the
  packaging weight; the UI was the complaint, not the only problem.
- **Node sidecar** (native shell + a Node CLI) — splits the logic across a
  process boundary and ships Node anyway.
- **Shell out to the existing Node CLI** from a native GUI — same Node dependency,
  plus a CLI surface that only Setup would use.
- **NativeAOT** — smallest/fastest, but Avalonia + AOT was too risky for a
  straight port; trimmed self-contained is the pragmatic step.

## Verification

- `npm run check` green: lint, typecheck, 444 TS tests, ES3 lint, bridge build,
  bundle pack, bundle smoke, **74 C# tests** (the new `dotnet:test`).
- `npm run installer:build` produces `AE-MCP Setup-<version>-arm64.dmg`; the
  trimmed `.app` launches and ships `payload.jsx`, `loader.jsx`, `ae-mcp.mcpb`.
- CI (`ci.yml`) runs `dotnet test` on ubuntu + macos; `release.yml`'s installer
  job builds the `.dmg` with `setup-dotnet`.
- End-to-end row-by-row install on a clean Mac remains **E11-7 / #126** (human).
