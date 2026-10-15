# Native AE-MCP Setup (Avalonia) — Design

- **Date:** 2026-10-15
- **Status:** Draft — approved in conversation, pending spec review
- **Deciders:** Stanislas (product/scope), agent (structure, build, testing)
- **Supersedes:** the Electron installer in `apps/installer` (only the installer
  app; the MCP server and bridge are unaffected).

## Context

The AE-MCP Setup app — the GUI that installs and repairs the After Effects
bridge — is an Electron app. Three problems drove this redesign:

1. **It is broken.** `apps/installer/build.ts:14-15` bundles the preload script as
   ESM (`import { contextBridge, ipcRenderer } from "electron"`), but Electron
   loads preload scripts as CommonJS (`SyntaxError: Cannot use import statement
   outside a module`). `window.installer` is never defined, `renderer.ts:58`'s
   `await window.installer.detect()` throws, and `main()` aborts **before**
   wiring any button (`renderer.ts:83`). Clicking Install does nothing and the
   checklist is empty. Verified live with `ELECTRON_ENABLE_LOGGING=1`.
2. **It is ugly.** The window is unstyled-ish HTML; the checklist reads poorly.
3. **It is heavy.** The `.dmg` is 122.6 MB (bundled Chromium).

Goal: replace the installer with a **native C# desktop app (Avalonia)**, published
**self-contained and trimmed**, with **no Node anywhere in the app** at runtime.

## Decisions

| # | Decision | Chosen | Rejected |
|---|----------|--------|----------|
| D1 | Installer brains | **Port to C#** — native, no Node in the app | Node sidecar; shell out to Node CLI |
| D2 | Behavior | **Straight port** — same 6 rows, same actions, same `.mcpb` handoff | Fix handoff by writing `claude_desktop_config.json`; redesign into a wizard |
| D3 | TS installer code after port | **Delete** the now-dead `packages/core` modules + tests | Keep as reference; keep permanently |
| D4 | Self-contained flavor | **Self-contained + trimmed** (`PublishTrimmed`) | Untrimmed; NativeAOT |

Accepted cost of D1: the installer-facing logic exists in two languages during
the port, and two small pieces (`ae-discovery`, `ae-extensions`) remain
duplicated afterwards because the **server** still uses the TS copies.

## Scope

**In:** the Setup GUI app only — detect, install/repair, uninstall, diagnostics,
live test; its build, packaging, CI, and tests; removing the Electron app and the
dead TS modules.

**Out:** the MCP server (`packages/server`), the bridge (`packages/bridge`), the
bundle/`.mcpb` (`bundle/`), the protocol package, and any behavior change to how
the bridge is installed.

## Architecture

```
apps/installer/
  AeMcpSetup.sln
  AeMcpSetup/              Avalonia app — views + view models, no logic
  AeMcpSetup.Core/         ported logic — no UI references, unit-testable
  AeMcpSetup.Core.Tests/   xUnit
  build/app-bundle.sh      assemble .app (Info.plist + icon.icns) and .dmg
  build/icon.icns          reused from the Electron build
```

Two projects (app + core) keep the ported logic testable headless. MVVM-lite:
one `MainWindow.axaml` + a `MainViewModel` exposing an
`ObservableCollection<ChecklistRow>`. No DI container, no MVVM toolkit — plain
`INotifyPropertyChanged` and Avalonia bindings.

### Ported logic (Core) — one-to-one with the TS

| C# unit | Ports | Responsibility |
|---|---|---|
| `AeDiscovery` | `ae-discovery.ts` | scan `/Applications` for `Adobe After Effects <year>.app`, ≥2025 |
| `AeExtensions` | `ae-extensions.ts` | list CEP extensions (user + system) |
| `ClaudeDiscovery` | `claude-discovery.ts` | find `Claude.app` + config dir |
| `Environment` | `environment.ts` | `detectEnvironment` = AE installs + Claude |
| `InstallPayload` | `install-payload.ts` | write `~/.ae-mcp/bridge/current.jsx`, `inbox/`, `outbox/`; version compare |
| `InstallLoader` | `install-loader.ts` | write `…/Scripts/Startup/ae-mcp-loader.jsx`; `osascript` elevation on `EACCES/EPERM/EROFS`; manual fallback text |
| `ScriptingPref` | `scripting-pref.ts` | enable `Pref_SCRIPTING_FILE_NETWORK_SECURITY` in AE prefs, with `.ae-mcp-backup` |
| `InstallMcpb` | `install-mcpb.ts` | `open -a Claude <mcpb>` |
| `LiveTest` | `live-test.ts` | heartbeat-freshness poll + `comp.create`/`project.undo` |
| `RepairUninstall` | `repair-uninstall.ts` | `repairAeMcp`, `uninstallAeMcp` |
| `Diagnostics` | `diagnostics.ts` | format a report, write to `~/Desktop` |
| `AeProcess` | `ae-process.ts` | `pgrep -f` "is AE running" |
| `BridgeCall` | `osascript-transport.ts` + `bridge.ts` | job-protocol call to AE (see below) |

Injectable seams carried over from the TS (`isRunning`, `call`, `launch`,
`openFile`, `elevatedWrite`, `now`, `sleep`) so tests never touch the real
system.

### The bridge protocol coupling

`BridgeCall` reproduces the osascript transport: write
`~/.ae-mcp/bridge/jobs/<id>.json` (a `JobMessage`), write the trigger `.jsx`
(`$.evalFile(current.jsx); AEMCP.processJob(jobs/<id>.json);`), run
`osascript -e 'tell application "<AE>" to DoScriptFile "<trigger>"'`, then read
`~/.ae-mcp/bridge/outbox/<id>.json` (a `ResultMessage`). Timeout → `AE_BUSY`;
missing result → `SCRIPT_ERROR`.

**Risk:** C# encodes this JSON independently of `packages/protocol`, so the
shapes can drift and break the live test silently.

**Mitigation:** a shared JSON fixture (a real captured job request + its result),
asserted by **both** a C# test and a TS test. One fixture, two assertions.

### Resources

`payload.jsx`, `loader.jsx` (from `packages/bridge/dist`) and `ae-mcp.mcpb`
(from `bundle:pack`) are copied into the project at build time and embedded as
resources. The .NET build therefore depends on the node build running first —
unchanged from today.

### Build & packaging

`installer:build` (npm orchestrator) =
`bridge:build` → `bundle:pack` → copy resources →
`dotnet publish -c Release -r osx-arm64 --self-contained -p:PublishTrimmed=true`
→ `build/app-bundle.sh` (assemble `AE-MCP Setup.app` with `Info.plist`,
`icon.icns`; `hdiutil` → `.dmg` with the Applications drop-link). arm64 first.

### CI

`npm run check` gains `dotnet build` + `dotnet test` on the new projects (both
runners; the mac-only `.app`/`.dmg` stays out of `check`). `release.yml`'s
installer job adds `setup-dotnet` and runs `installer:build`, then uploads the
`.dmg`.

### UI

Single column, grouped card list of the 6 rows: left label, right status pill
(`OK` / `Fix` / `—`), the fix hint as secondary text on failures. Top bar:
**Install** (primary), **Uninstall**, **Export diagnostics**; a progress line
below; the "quit After Effects" prompt as an inline banner. Native macOS look
(Avalonia Fluent), system light/dark, no custom chrome.

### Testing

Port the TS tests to xUnit (discovery, install-payload, install-loader,
scripting-pref, live-test, repair-uninstall, checklist) with temp dirs and the
injected seams. Add the §"protocol coupling" contract test. The ported tests are
the proof the C# matches the TS before the TS is deleted (D3).

### Deletion sweep (after the port is green)

Remove the 10 dead `packages/core` modules + tests: `install-payload`,
`install-loader`, `scripting-pref`, `install-mcpb`, `live-test`,
`repair-uninstall`, `claude-discovery`, `environment`, `diagnostics`,
`ae-process`. Remove the electron/electron-builder devDependencies. Drop
`apps/installer` from npm `workspaces`. `core` keeps `ae-discovery`,
`ae-extensions`, `aerender-*`.

## Risks

- **Trimming + Avalonia**: XAML/reflection may need `[DynamicDependency]` or
  explicit roots. Each of the 6 rows must be exercised in the trimmed bundle
  before the TS is deleted.
- **`ScriptingPref`** is the subtlest port (prefs `.txt` backup + `[Main Pref
  Section v2]` edit). Highest risk — port and test it first.
- **`osascript` quirks** carry over: the admin prompt, and AE refusing a second
  script (`DoScriptFile` blocks) mapping to `AE_BUSY`.

## Acceptance criteria

1. `AE-MCP Setup.app` installs the bridge and runs the live test green on a
   clean Mac (unblocks E11-7), with **no Node and no Electron** in the app.
2. `npm run check` is green (including `dotnet build`/`dotnet test`).
3. The trimmed, self-contained `.dmg` is materially smaller than 122.6 MB
   (target: < 60 MB).
4. The 10 dead `packages/core` modules and the Electron app are gone.
5. The UI passes a visual read: legible checklist, clear status, obvious primary
   action.

## Out of scope

- x64 `.dmg` (arm64 first; the Electron build made both).
- Code signing / notarization (stays unsigned, `identity: null` semantics).
- Any change to how Claude Desktop is handed the `.mcpb` (D2 = straight port).
