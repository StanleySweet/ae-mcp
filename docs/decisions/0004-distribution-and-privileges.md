# ADR-0004: Distribute Setup as a DMG + `.app`; keep the AE loader as the only privileged step

Date: 2026-10-15
Status: Accepted
Decider: Stan (owner)
Authors: Stan (owner)
References:
- ADR-0001 (transport B, osascript) — the MCP works without the loader
- ADR-0003 (native installer) — this refines how it is packaged and signed
- After Effects scripting guide, "Running scripts automatically during
  application startup or shutdown" (startup scripts run only from the AE
  application's `Scripts/Startup` folder)

## Context

Setup must do two kinds of work:

1. **User-level** — install the bridge payload into `~/.ae-mcp`, enable AE's
   `Pref_SCRIPTING_FILE_NETWORK_SECURITY` pref, hand the `.mcpb` to Claude
   Desktop, run a live test, export diagnostics.
2. **Privileged (one step)** — write the startup loader into
   `/Applications/Adobe After Effects <ver>/Scripts/Startup/`, which is
   root-owned. The AE scripting guide confirms startup scripts auto-run **only**
   from this application folder; there is no documented user-level auto-startup
   path, so this step genuinely needs admin.

A `.dmg` is just a disk image; the `.app` inside runs unprivileged as the user.
macOS never elevates on launch — an app must ask. Setup asks via
`osascript … do shell script … with administrator privileges`, and only at the
loader step. Two defects were found while exercising this:

- A fresh install created `~/.ae-mcp` at **0755**; the `check_setup`
  `queue_permissions` row failed until the server's first bridge call lazily
  chmod'd it to 0700.
- The built `.app` was ad-hoc signed under the .NET **`apphost`** identifier
  rather than `com.aemcp.setup`, so TCC (Automation/Desktop) and the admin prompt
  keyed on the wrong identity.

## Decision

Keep shipping Setup as a **`.dmg` containing the `.app`**. Do **not** convert to
a `.pkg`. The one privileged step (the AE loader) is performed by the app through
`osascript … with administrator privileges`; the dmg is signed (ad-hoc) under
`com.aemcp.setup`, and the installer creates `~/.ae-mcp` at 0700.

The loader is treated as **optional**: the MCP works over transport B (osascript)
without it. The loader only adds the startup heartbeat (and the transport-A
fallback), so a machine where the user declines the admin prompt still has a
working MCP; only `check_setup.bridge_heartbeat` / `ae_context.connected` stay
red.

## Consequences

- The guided UI (detect AE/Claude, prefs, `.mcpb` handoff, live test, diagnostics)
  runs in the user's session — impossible from a headless `postinstall`.
- The privileged write happens at runtime behind one clear admin prompt; the
  user-level steps never prompt.
- Declining the admin prompt degrades gracefully (transport B) instead of
  blocking install.
- The `.app` is ad-hoc signed, not notarized; a Developer ID would remove the
  "unidentified developer" friction but is not required for the prompt to work.

## Alternatives considered

- **Full `.pkg`** — the native vehicle for a root install, but its `postinstall`
  runs headless as root: it cannot show the guided UI, cannot act in the login
  session (`open -a Claude`, write the user's `~/`/prefs), and cannot run the live
  test. It would fight the product, not simplify it.
- **A tiny `.pkg` for just the loader**, opened by the app — viable if a native
  admin prompt is wanted for that one step; deferred.
- **Privileged helper via `SMJobBless`** — the most robust long-term route, but
  needs a Developer ID + notarization; heavier than the problem.
- **Drop the loader entirely** — removes the only privileged step (admin-free
  install) but loses the startup heartbeat and the transport-A fallback; deferred
  unless the heartbeat proves not worth the prompt.

## Verification

- `InstallPayload` chmods `~/.ae-mcp` 0700 (**2 new tests**; 78 C# tests green).
- `app-bundle.sh` re-signs the bundle `--deep` as `com.aemcp.setup`
  (`codesign -dvv` shows `Identifier=com.aemcp.setup`); the app still launches.
- On this Mac: loader installed via the same `osascript` command (admin prompt),
  AE restarted, `check_setup` → `bridge_heartbeat: ok` **and**
  `queue_permissions: ok`; `ae_context` → `connected: true`, transport
  `startup-loader`.
