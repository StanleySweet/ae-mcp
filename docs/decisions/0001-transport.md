# ADR-0001: Transport for After Effects scripting

Date: 2026-10-09
Status: Accepted
Authors: Stan (owner)
References:
- `docs/spike/README.md` (run instructions + measured results, Mac 1)
- `docs/BACKLOG.md` E1 (spike) and E2/E3 (bridge/protocol depend on this choice)
- https://ae-scripting.docsforadobe.dev/introduction/overview/ (AppleScript integration)
- https://ae-scripting.docsforadobe.dev/general/application/#appexitcode

## Context

The MCP bridge must run scripts in the user's open After Effects and deliver the
result back to the client. Two transports were prototyped in `packages/spike`:

- **A — startup loader**: a `Scripts/Startup` script polls `~/.ae-mcp/spike/inbox`
  every 200 ms via `app.scheduleTask`, echoes `<id>.txt` jobs to the outbox;
  Node (`inbox.ts`) writes jobs and polls for results. Requires AE running so the
  loader is alive.
- **B — osascript**: Node shells out to
  `osascript -e 'tell application "<AE>" to DoScriptFile "<job.jsx>"'` per call.
  On macOS `DoScriptFile` returns the value of `app.exitCode`, not the last
  expression, so scripts return results by setting `app.exitCode`.

Spike questions measured on Mac 1 (MacBook Pro, Apple Silicon, After Effects
2026, prefs dir `26.5`): Startup folder writable without admin, loader polls
with no panel open, no "second script" warning under concurrent scripts,
write-access pref (`Pref_SCRIPTING_FILE_NETWORK_SECURITY`) persists as plaintext
in `Préfs.txt`, and both transports handle cold launches (A picks up a queued job
~37 s after `open`; B self-launches AE and returned in ~7 s).

Latency/failure over 100 round trips, two runs:

```
A startup-loader: count=200 ok=194 failed=6  mean=249.9 p50=209/288 p95=213/392 max=497
B osascript    : count=200 ok=200 failed=0  mean=181.3 p50=145/200 p95=158/302 max=683
```

A's 6 failures were results arriving after the 10 s wait window (loader stalls
under a 100-job burst), none lost — the inbox was empty and all result files were
present. B never failed.

## Decision

Use **transport B (osascript `DoScriptFile`)** as the primary transport for the
bridge. Transport A (startup loader) is retained as the fallback and used when
transport B is unavailable (e.g. AppleScript/`DoScriptFile` broken — reported on
AE 24.x, where JXA is the workaround). `check_setup` reports the active
transport; the bridge probes B first and falls back to A.

## Consequences

- The bridge depends on macOS `osascript` and on the AE AppleScript integration
  (`DoScriptFile`). The known AE 24.x unreliability is mitigated by the fallback.
- Script files must return values by setting `app.exitCode` (ES3-compatible),
  matching how AE reports the `DoScriptFile` result on macOS.
- AE does not need to be pre-launched: transport B auto-launches it (~7 s to
  first script execution on Mac 1).
- Per-call `osascript` spawn is fast enough (~145–216 ms p50) for MCP tool
  latency and avoids the 3% late-result stalls transport A shows under burst.

## Alternatives considered

- **A as primary (the backlog default "prefer A, fall back to B")**: rejected —
  measured data on Mac 1 shows B is both faster and more reliable, and B
  cold-launches AE. A remains the fallback since it is AppleScript-independent
  and survives AE restarts without a spawn boundary.
- **JXA (`osascript -l JavaScript`)**: noted as the workaround if `DoScriptFile`
  proves unreliable on AE 24.x; not adopted because it worked cleanly on AE 2026.

## Verification

- `npm run spike:bench` on Mac 1: results pasted in `docs/spike/README.md`
  (Mac 1 block). Mac 2 results pending on the owner's second machine.
- Single-trip smoke tests for both transports pass (transport A + B round trips
  verified while writing the spike).