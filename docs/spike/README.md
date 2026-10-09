# E1 transport spike: run instructions and results template

Backlog task E1-5 — run on both Macs by the owner, fill the template below, then
commit `docs(adr): 0001 transport decision`. The measured results answer the six
questions and become the ADR's evidence. Spike tooling lives in `packages/spike`
(E1-1..E1-3).

## Transports under test

- **Transport A — startup-loader** (`packages/spike/transport-a/startup-loader.jsx`).
  A `Scripts/Startup` script that polls `~/.ae-mcp/spike/inbox` for `<id>.txt`
  jobs with `app.scheduleTask`, echoes each to `~/.ae-mcp/spike/outbox/<id>.txt`,
  then consumes the job. Node drives it via `packages/spike/src/inbox.ts`
  (`send` / `waitForResult` / `readResult`).
- **Transport B — osascript** (`packages/spike/src/osascript.ts`).
  One `osascript -e 'tell application "<AE app name>" to DoScriptFile "<job.jsx>"'`
  invocation per call. AE executes the script file and returns its result —
  measured on macOS as the value of `app.exitCode` (default 0), so scripts set
  it to return a value.
  AE AppleScript integration: https://ae-scripting.docsforadobe.dev/introduction/overview/
  `app.exitCode`: https://ae-scripting.docsforadobe.dev/general/application/#appexitcode

## Prerequisites

- After Effects installed and licensed. Record the exact version (it matters —
  question 4): **AE version:** `___`
- Node 24 (`npm ci` from the repo root), `npm run check` green.
- For transport A, AE must be running so the Startup loader is alive.

## Transport A — setup and check

1. Enable **Preferences > General > "Allow Scripts to Write Files and Access
   Network"** — the loader writes result files to the outbox. (This is the
   preference question 4 probes.)
2. Copy `packages/spike/transport-a/startup-loader.jsx` into the user Startup
   folder:
   `~/Library/Preferences/Adobe/After Effects/<version>/Scripts/Startup/`
   Note whether the copy works without admin rights (question 1).
3. Launch AE. The loader runs on startup and starts polling every 200 ms.
   Confirm `~/.ae-mcp/spike/inbox` and `outbox` were created.
4. With AE at idle and no panels/comps open, verify a round trip still
   completes (question 2).

## Transport B — setup

- AE must be running. If the AppleScript app name differs from the default
  `Adobe After Effects 2025`, set `AE_APP_NAME` before running the benchmark,
  e.g. `export AE_APP_NAME="Adobe After Effects 2024"`.
- Known risk to record: the AppleScript `DoScriptFile` path has been reported
  unreliable on AE 24.x (JXA is the workaround). If B fails or hangs, record the
  osascript stderr in question 6.

## Benchmark — latency and failure rate over 100 round trips

From the repo root, with AE running:

```sh
npm run spike:bench   # COUNT=100 default; override via COUNT=200 etc.
```

The harness runs transport A then transport B, printing `count ok failed` plus
`mean p50 p95 max` latency (ms) for each. Paste the output into question 6.

Cold-start behaviour (question 5): quit AE completely, then run
`npm run spike:bench` and record what happens for each transport (transport A
cannot cold-launch AE — the loader only runs once AE is already up; verify and
note what a queued job does when AE starts afterwards).

## Results template

Fill one block per Mac.

### Mac 1

- Machine / macOS: MacBook Pro (Apple Silicon), macOS locale French
- AE version: After Effects 2026 (prefs dir `26.5`)

1. **Is Scripts/Startup writable without admin rights?**
   Yes — copying the loader into `~/Library/Preferences/Adobe/After Effects/26.5/Scripts/Startup/` succeeded without an admin prompt.
2. **Does a Startup script keep polling with no panel open?**
   Yes — loader serviced all benchmark jobs with AE at idle and no panel/comp UI open.
3. **Does polling cause the 'second script' warning when a user script runs?**
   No — 20 concurrent `DoScriptFile` calls fired while the loader was servicing 30 jobs all succeeded (0 failures); AE serializes execution, no warning surfaced. (Pref `Pref_WARN_WHEN_RUNNING_SCRIPTS` is 01 in prefs but did not trigger in this scenario.)
4. **Does editing AE's prefs file to allow scripts to write files persist?**
   Yes — the write-access preference is `Pref_SCRIPTING_FILE_NETWORK_SECURITY` (2 − "1" = allowed, 0 = denied) in the `[Main Pref Section v2]` block of `~/Library/Preferences/Adobe/After Effects/26.5/Adobe After Effects 26.5 Préfs.txt`, written when AE quits and honored across restart (the loader wrote the outbox after the pref was set and AE restarted).
5. **Does cold-launching AE work, and after what?**
   Transport A: a job queued while AE is off is processed once the Startup loader comes up — 37.4 s after `open` (AE's full cold boot on this Mac). Transport B: osascript launches AE itself and `DoScriptFile` returned exit 0 in 7.1 s (the script runs once AE's scripting engine is up, before full UI boot).
6. **Latency and failure rate over 100 round trips** (two runs):

   ```
   Run 1:
   A startup-loader: count=100 ok=97 failed=3  mean=201.6 p50=209.0 p95=213.0 max=314.0
   B osascript    : count=100 ok=100 failed=0  mean=146.3 p50=145.0 p95=158.0 max=174.0
   Run 2:
   A startup-loader: count=100 ok=97 failed=3  mean=298.2 p50=288.0 p95=392.0 max=497.0
   B osascript    : count=100 ok=100 failed=0  mean=216.3 p50=200.0 p95=302.0 max=683.0
   ```

   A's 3 failures per run were late results (>10 s wait window), not lost jobs — the
   inbox was empty and all 100 result files were present in the outbox; the loader
   stalls under a 100-job burst. Single round trips never failed.

   Additional finding (harness change): on macOS `DoScriptFile` returns the value of
   `app.exitCode`, not the last expression; benchmark transport B uses
   `app.exitCode = 0;` and reads the result as `"0"`.

### Mac 2

- Machine / macOS: `__`
- AE version: `__`

1. **Is Scripts/Startup writable without admin rights?**
   `__`
2. **Does a Startup script keep polling with no panel open?**
   `__`
3. **Does polling cause the 'second script' warning when a user script runs?**
   `__`
4. **Does editing AE's prefs file to allow scripts to write files persist?**
   `__`
5. **Does cold-launching AE work, and after what?**
   `__`
6. **Latency and failure rate over 100 round trips** (paste `npm run spike:bench` output):

   ```
   A startup-loader: __
   B osascript:      __
   ```

## Decision

Default if both work: prefer A, fall back to B, and report the active one in
`check_setup`. Record the recommendation — and any 24.x caveats — in
`docs/decisions/0001-transport.md`.