# JOURNAL

Append-only progress log. Newest entry first. One entry per session or per landed
chunk of work; don't rewrite old entries — supersede them.

## 2026-10-15

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
