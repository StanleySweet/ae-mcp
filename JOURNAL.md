# JOURNAL

Append-only progress log. Newest entry first. One entry per session or per landed
chunk of work; don't rewrite old entries — supersede them.

## 2026-10-17

- **`chore(release): v1.3.0`**: ships #212–#223, from Claude Desktop feedback on `bunny.aep` and the competitor gaps.
  - **Fixes:** the Gradient Ramp NO_VALUE crash, `check_setup`'s circular advice, and keyframed properties failing on set (#223, found by the test drive).
  - **Features:** richer shapes; `layer.rename` and a full `set_transform`; snapshot/diff/sample; templates and looks; folder import, reduce and consolidate; required fields in the catalog; `eval.run`, which had never been built; correct ease counts.
  - **Docs:** a Claude skill (`skills/ae`), plus Cursor and Claude Code install notes.
  - **Process:** seven Haiku agents in worktrees, following a shared rules file (`.tmp/agent-rules.md`). One agent pushed to `main` by mistake; it was a clean fast-forward and CI passed, so it was kept.
  - **Test drive on AE 26.5:** 135 passed, 0 failed, 16 skipped.

- **`chore(release): v1.2.0`**: ships #187–#211.
  - **Features:** dialogs, batch rollback, file import, camera/light/3D, snippets and templates, keyframe tools, project open/save/import-JSON, AE_NOT_RUNNING, and a smaller `property.list`.
  - **Installer:** checks what it installed and tells a fresh install from an update; the dmg ships an unquarantine helper.
  - **Fixes:** the "undo group mismatch" warning (#195), the audit fixes #201–#208, and the bugs the test drive found (#209–#211).
  - **Process:** built by Sonnet and Haiku agents in worktrees, merged one commit at a time through `npm run check`.
  - **Live gate:** the new `npm run test:drive` (#200) ran on AE 26.5 with 115 passed, 0 failed, 13 skipped.
  - **Gotcha:** two #198 tests reached the real `pgrep` and passed only while AE was running; fixed in `df3371f`.
  - **Still open:** #196 does not verify the Claude extension.

- **`chore(release): v1.1.0`**: bumped `package.json`, `bundle/manifest.json` and
  `SERVER_VERSION`, then tagged `v1.1.0`. It ships #175–#186. Minor rather than major:
  the 17 MCP tools are unchanged, and the operations changed under ADR-0007 are
  discovered at runtime through `ae_catalog`.

- **Repo audit → #178–#186, all fixed and closed** (ADR-0007 records the contract
  changes; Decider: Stan). `render.frame` lost its `file` argument (#178, a
  read-only op could overwrite any file). The AE app name now comes from
  `discoverAEVersions` (#179: AE 2026 had always fallen back to the file queue).
  `render.queue_start` was removed (#180). `{success:false}` results became
  `INVALID_ARGS` errors and `increment_save` raises `UNSAVED_PROJECT`, with one
  shared guard helper (#181). Each batch step gets every standalone check; this
  also closed an `eval.run`-inside-`batch.run` bypass of the eval gate (#182).
  Fresh deadline per AE_BUSY retry (#183). The 44 comp loops became
  `aemcpRequireComp` (#184, −455 lines). `shape.add` takes `name` for the shape
  and `layerName` for a new layer (#185). `ae_do` no longer appends `context`
  (#186). `npm run check` green at each commit (513 TS, 81 C#); bridge changes
  smoke-tested live. The server changes reach users only after the mcpb is
  rebuilt and reinstalled.

- **#176 `ae_render_frame` race fixed** (`d4948d5`). The unsaved-project theory was
  wrong. After a save the call returned an empty image instead of ENOENT, while
  the file on disk was a valid PNG. `saveFrameToPng` returns a DeferredCall before
  AE writes the file, so the server now polls for a complete PNG (`IEND`) before
  reading it. It takes effect for the user only after the mcpb server is rebuilt
  and reinstalled.
- **#177 mask ops on match names.** Mask atom/path match names were read from
  live AE (`ADBE Mask Atom`, `ADBE Mask Shape`) because the guide does not list
  them; the handlers now use `AEMCP_MATCH` plus `aemcpAddProperty`. The new mock
  `MockMaskParade` uses fr_FR display names, so display-name lookups fail in tests.

## 2026-10-16

- **#175 shipped and verified live** (`0b230d8`, CI green). With the rebuilt
  payload hot-loaded into `~/.ae-mcp/bridge/current.jsx`, the Almond path
  `shape.add` that had crashed AE twice succeeded on AE 26.5, followed by a
  two-ellipse `batch.run` (`shape.read` → 3 groups). Seen in passing:
  `ae_render_frame` on that unsaved project returned `ENOENT` for
  `~/.ae-mcp/render/HANG_TEST-0.png`. Not investigated.

- **AE crash on `shape.add type:"path"` diagnosed and fixed (uncommitted).** It was
  reproduced live from Claude Code through the installed mcpb server. The crash
  report puts the fault in `addProperty` → `BEEp_MakeUniqueNameForStream` (null
  deref). The cause was the nonexistent match name `'ADBE Vector Shape - Path'`;
  the correct one is `ADBE Vector Shape - Group`. Fix: the `AEMCP_MATCH` table plus
  `aemcpAddProperty` (`canAddProperty` guard), shape contents addressed by match
  name, `match-names.test.ts` to keep literals out of the code,
  `shape-handlers.test.ts`, and mock `MockVectorsGroup`/`MockShape`. `npm run
  check` green (494 TS, 81 C#). See
  `docs/findings/2026-10-16-shape-path-matchname-crash.md`. Not yet re-tested on
  live AE: that needs a rebuilt payload installed. Open: `mask.add` still uses
  display names (no documented atom match name).

- **E11-8 `chore(release): v1.0.0`** — cut v1.0.0. Bumped the three shipped
  versions to 1.0.0: root `package.json` (drives the Setup app + dmg name),
  `bundle/manifest.json` (extension version; `bundle/manifest.test.ts` keeps it
  in step with `package.json`) and `SERVER_VERSION` in
  `packages/server/src/server.ts`. The private workspace `package.json`s stay at
  `0.0.0` — they are never published and esbuild inlines them. Found and fixed a
  release-pipeline gap: `release.yml`'s installer job ran plain
  `installer:build`, which builds a single arch (`scripts/build-installer.ts`
  defaults to `arm64`), so a tag would have shipped only the Apple-Silicon dmg
  and failed Story 11.1. The job is now an `arm64,x64` matrix running
  `installer:build` with `AE_MCP_ARCH`, uploading per-arch artifacts the publish
  job globs into the release. Verified locally both dmgs build at 1.0.0
  (`AE-MCP Setup-1.0.0-{arm64,x64}.dmg`). `npm run check` green.

- Finished the sweep by closing the last two bridge bugs. **#174** (`5c85b6a2`):
  `property.list` always returned `[]` because it read `layer.property.keys`,
  but `property` is a function — it now walks `layer.numProperties`/`property(i)`
  recursively (`aemcpListProperties`) and returns
  `{layers:[{index,name,properties}]}` with nested groups. **#173**: redesigned
  the `effect.*` family per **ADR-0006**. Every op now takes a layer `index`
  (default 1) and names the effect by display **or match name**; `apply` calls
  `ADBE Effect Parade.addProperty` (apply = add, duplicates allowed), `remove`
  calls `PropertyBase.remove`, `list_on_layer` lists the parade,
  `list_available` reads `app.effects` as `{name,matchName,category}`,
  `set_property`/`set_keyframe` resolve the effect then its property via
  `aemcpResolveProperty`. `effect.apply_template` (a success-returning no-op) is
  **removed**; `.ffx` presets stay on `preset.apply_ffx`. Reused the
  `bulk.apply_effect` parade pattern. `npm run check` green: 488 TS tests, ES3
  lint, bundle smoke 17 tools, dotnet 81.

- Fixed six bugs found while driving a real project, and filed two more. Six
  issues filed and closed: **#167** `ae_render_frame` rejected args (client-side)
  and returned an oversized image — the oversized half is fixed, `ae_render_frame`
  now takes `maxEdge` (default 1568) and downscales through macOS `sips`
  (`7958c610`); **#168** `layer.bounds` returned the comp rect — now
  `sourceRectAtTime` + `sourcePointToComp` comp-space box, erroring when the layer
  cannot report bounds; **#169** `property.*`/`expression.*` hardcoded `comp.layer(1)`
  — now an `index` arg plus `aemcpResolveProperty` nested-path resolution, and
  `expression.set`/`clear`/`check_errors` drive `Property.expression`/
  `expressionEnabled`/`expressionError` for real; **#170** `keyframe.add`,
  `property.set`, `effect.set_property`/`set_keyframe` treated `0` as missing;
  **#171** `text.add`/`set`/`read` gained `font`/`justification`/`tracking`/`leading`
  and `text.add` now applies `fillColor` without requiring `fontSize`; **#172**
  `check_setup` gained a `bridge_capabilities` row that compares the heartbeat's
  reported operations against the server registry and fails when the installed
  payload is stale (`c546aba0`). The four interleaved bridge fixes share one commit
  (`2d83f459`) because their edits sit in the same hunks. `npm run check` green:
  484 TS tests, ES3 lint, bundle smoke 17 tools, dotnet 81.
- **Filed #173** (`effect.apply`/`remove`/`list_on_layer`/`list_available`/
  `apply_template` are broken — `effect.remove` is a no-op, `apply` does not add;
  needs a contract redesign, reuse `bulk.apply_effect`) and **#174**
  (`property.list` always returns `[]` — `layer.property` is a function, should be
  `layer.property(index)`), both `needs-triage`.
- Docs in the same commits: user-guide and troubleshooting now describe six
  `check_setup` rows, code-map refreshed (server.ts tool line numbers, the new
  render/check helpers), and the fr_FR finding is captured as **BACKLOG §2 rule 11**
  + `docs/findings/2026-10-16-localized-property-names.md` (`b87d9aa8`): address AE
  properties/groups/effects by **match name**, never a localized display name.
- Follow-up to #149: animation principles now reach **MCP callers**, not just
  repo agents. `packages/server/src/index.ts` imports
  `docs/agents/animation-principles.md` as text (esbuild `loader: { '.md': 'text' }`
  in `bundle/pack.ts`, ambient `md.d.ts` for tsc) and passes it through a new
  `ServerOptions.instructions` to `McpServer`, so every client receives it in the
  `initialize` result (`client.getInstructions()`). Single source: the md file.
  Tests: plumbing unit test in `server.test.ts`, packed-bundle assertion in
  `bundle/smoke.test.ts`. No test imports `index.ts`, so vitest never sees the md
  import. User guide notes it under First run.
- Installed the ae-mcp MCP into **opencode** against the **production** bundle
  instead of the tsx source run: `~/.config/opencode/opencode.json` now launches
  `node /Users/stan/Dev/ae-mcp/dist/staging/server/index.js` — the esbuild artifact
  shipped inside `dist/ae-mcp.mcpb`. Verified over stdio: 17 tools, `check_setup`
  green (only `project_saved_version` fails — the project was never saved). The
  queue is identical either way (`queueRoot()` = `AE_MCP_ROOT ?? ~/.ae-mcp`).
  (`bridge_heartbeat` flapped to fail before AE was reopened — expected: the
  heartbeat only ticks while AE runs, and it ages out after 90 s.)
- Resumed the backlog loop. Housekeeping: closed epics **E12 (#15)** and **E13
  (#16)** — every task under each is closed. Triage: **#149** (Animation Principles
  agent-context) `needs-triage` → `ready-for-agent`.
- Accepted **ADR-0002** third-party tool support (`9839b7b0`, task E14-2, closes
  #133) from the Mac 1 results; Mac 2 stays pending on the owner's second machine —
  the same standing ADR-0001 recorded. The ADR declares **E14-9/E14-10/E14-11
  unsupported** (Animation Composer keeps no on-disk preset library; Motion exposes
  no script entry point), so #140/#141/#142 were closed `wontfix` and BACKLOG §E14
  annotated to match.
- Frontier is now **E14-12 (#143)** `ease.preset for selected keyframes (ease in,
  ease out, overshoot)`: its blockers (#142, #73) are closed. AE APIs looked up for
  it — `Property.selectedKeys` (read-only int array) and `KeyframeEase(speed,
  influence)` / `setTemporalEaseAtKey` (one ease per value dimension).
- Landed **E14-12 (#143)** as the `keyframe.ease_preset` op (`8044a6fe`) —
  influence-only curves (speed 0; `ponytail:` note: a fixed speed is meaningless
  across property types, upgrade path = custom speed args), one ease per value
  dimension, wrapped in the expression warning. The op name follows the
  `category.op` invariant (`ease` is not a category).
- Landed **E14-13 (#144)** as the `anchor.move_preserving` op (`5ffd40e`) — nine
  named anchor positions or a literal `[x,y]`, moving the anchor while keeping the
  layer visually in place via `sourceRectAtTime` + `sourcePointToComp` (delta taken
  as `posNew = posVal + delta` after a first-attempt sign error — mock divergence,
  `sourcePointToComp` is identity-only there).
- Landed **E14-14 (#145)** as the `expression.snippet` op (`c9c4c744`) — four
  named snippets (`wiggle`, `loop`, `delay`, `overshoot`) applied via
  `Property.expression` + `Property.expressionEnabled`. Snippets are the documented
  expression forms; `overshoot` is an original damped-sine spring built from
  `velocityAtTime` + `Math` (no vendor code, rule 5).
- Landed **E14-15 (#146)** as the `rig.null_controller` op (`eb745c4`) — creates
  a controller null (`LayerCollection.addNull`), adds one `ADBE Slider Control`
  effect per requested name via `ADBE Effect Parade.addProperty`, and parents the
  given layers with `Layer.parent` (targets resolved before mutating so a bad index
  leaves the comp untouched). New `rig` operation category. Also corrected the
  stale v1.1 op list in BACKLOG (it still named the never-built
  `thirdparty.apply_preset`/`thirdparty.search` and the wrong `ease.preset` name).
- **Epic E14 (#17) closed** — every task issue under it is closed (E14-9/10/11
  `wontfix` per ADR-0002). The Animation Principles slice shipped as E14-12..15.
- Frontier: the backlog loop is now blocked on the [HUMAN] task **E11-7 (#126)**
  (clean-Mac install run), which blocks **E11-8 (#127)** and epic **E11 (#14)**.

## 2026-10-15

- Root-caused why Setup never prompted for admin and never installed the loader:
  `InstallLoader` built the AppleScript with `JsonSerializer.Serialize`, whose
  HTML-safe encoder turns `'`/`&` into `\u0027`/`\u0026` — invalid in AppleScript
  → osascript error `-2741` **before** the prompt. Fixed with proper AppleScript
  quoting (`ElevationScript`/`QuoteAppleScript`); the manual Node install had
  hidden it. Finding: `docs/findings/2026-10-15-json-serialize-breaks-applescript.md`.
- Setup install made **atomic and verified** (ADR 0005): the privileged loader
  runs first and a failure aborts before anything else is written (no more half
  installs); the `bridge_loader` result is folded into the visible "Bridge
  installed" row (its failure used to be invisible); the live test now runs
  whenever the bridge is installed, not only when every check passed; the window
  explains the admin prompt.
- Fixed two Setup bugs found by exercising the MCP: (1) the installer created
  `~/.ae-mcp` at 755 so `check_setup` reported `queue_permissions: fail` until the
  first bridge call lazily chmod'd it — now `InstallPayload` chmods it 0700; (2) the
  built `.app` was ad-hoc signed as `apphost` (the .NET default), so TCC/admin
  prompts were keyed wrong — `app-bundle.sh` now re-signs the bundle as
  `com.aemcp.setup`.
- Fixed the Setup **scripting-pref** row on a localized AE: `FindPrefsFile` matched
  the English `Prefs.txt`, but French AE writes `Préfs.txt` and macOS returns it
  NFD-decomposed, so it never matched (the row looped on "open AE once" /
  "quit AE"). Now NFC-normalizes the name and accepts both; regression tests use
  the NFD name. The TS original had the same bug. See
  `docs/findings/2026-10-15-localized-ae-prefs-filename.md`.
- Replaced the Electron **AE-MCP Setup** with a **native Avalonia (C#) macOS app**
  (`apps/installer/AeMcpSetup*`, `net10.0`, Avalonia 11.3.11): ported the installer
  logic to `AeMcpSetup.Core`, wrote the xunit suite (74 tests) and the single-column
  6-row UI, and added a shared bridge-protocol fixture (`packages/protocol/contract/`)
  asserted by both a C# and a TS test. Deleted the Electron app and the 10 now-dead
  `packages/core` installer modules. `installer:build` now publishes a self-contained
  **trimmed** `AE-MCP Setup.app` + `.dmg` (`scripts/build-installer.ts` +
  `build/app-bundle.sh`); CI gained `dotnet test` + `setup-dotnet`, `release.yml`'s
  installer job uses them. `npm run check` green (444 TS tests, 74 C# tests); the
  trimmed app launches with the three resources (payload/loader/mcpb) in the bundle.
- Committed the native-installer design spec (`58203a2`,
  `docs/superpowers/specs/2026-10-15-native-installer-design.md`).
- Shipped the **AE-MCP Setup** install path end to end: bundled the bridge payload
  and loader (`68a466e`), installed the Claude extension and ran the live test
  (`9609176`), added the app icon + DMG drag-to-Applications layout (`4e82f9b`),
  and kept the Setup bundle self-contained (`cc9bbea` — asar 14.8M → 951.5K,
  node_modules entries 3231 → 0).
- Fixed the destructive guard so it surfaces the bridge's real `increment_save`
  error instead of a hardcoded `UNSAVED_PROJECT` (`c8e34e4`, closes #161). A
  never-saved project is still refused with `UNSAVED_PROJECT`; any other failure
  now returns `SCRIPT_ERROR` with the real message.
- Committed the keyframe operations — transform-property resolution
  (`aemcpResolveProperty`) and dimensional eases (`setInterpolationTypeAtKey` +
  `setTemporalEaseAtKey`, one `KeyframeEase` per `numDimensions`) — with mock
  support and tests (`3d2f3a1`, closes #166).
- Wrote `docs/findings/2026-10-15-extendscript-mock-divergences.md` (`10432d8`):
  ExtendScript vs mock divergences, the stale-payload trap, and the guard misblame.
- Updated `docs/agents/code-map.md` for the #161 guard behavior (`7c9b905`).
- Created `CONTEXT.md` and this journal.
- Added the `ae-mcp` server entry back to Claude Desktop's
  `claude_desktop_config.json` (it had been removed during clean-state prep).
- Open: **E11-7 / #126** is a `[HUMAN]` clean-Mac install test — instructions live
  in `docs/test-runs/clean-mac-install.md`; it needs a run on a clean Mac and its
  results committed, which an agent cannot do.
