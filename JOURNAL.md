# JOURNAL

Append-only progress log. Newest entry first. One entry per session or per landed
chunk of work; don't rewrite old entries — supersede them.

## 2026-10-15

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
