# ADR-0005: Atomic, verified install — privileged loader first, live test always

Date: 2026-10-15
Status: Accepted
Decider: Stan (owner)
Authors: Stan (owner)
References:
- ADR-0004 (distribution + privileges) — refines its "loader is optional" clause
- ADR-0001 (transport B, osascript)
- `apps/installer/AeMcpSetup.Core/{RepairUninstall,InstallLoader,Checklist}.cs`,
  `apps/installer/AeMcpSetup/SetupService.cs`

## Context

Exercising the installed app surfaced three defects in the install flow:

1. **Half installs.** `InstallLoader.InstallAsync` wrote directly and only popped
   the admin prompt *after* a permission error; if the prompt failed or was
   declined it returned a `fail` row and **the install continued**. The payload
   got installed and the loader did not — a half install.
2. **No verification on failure.** `SetupService.RepairAsync` ran the live test
   only when *every* check passed (`checks.All(IsOk)`), so exactly when something
   failed the user got no proof of what worked.
3. **Invisible failure.** The checklist has six rows and none is `bridge_loader`.
   A loader failure set `result.Ok = false` ("Some steps need attention") while
   every *visible* row stayed green — the step that failed was the one the user
   could not see.

The live test depends on a fresh heartbeat, which only the **loader** writes, so
the loader is required for Setup to verify itself. It is the only step that can
fail on permissions (the AE `Scripts/Startup` folder is root-owned).

## Decision

Make the install **atomic and verified**:

- **Privileged step first, all-or-nothing.** `RepairUninstall.RepairAsync` installs
  the **loader first**; if it cannot be installed, it returns immediately and
  writes **nothing else**. Complete install or none — never a half install. The
  admin prompt therefore comes up front, before any change.
- **Surface the loader.** The `bridge_loader` outcome is merged into the visible
  "Bridge installed" (`bridge_payload`) row, so a loader failure shows with its
  fix instead of hiding behind a green row.
- **Always verify.** Once the core (loader + payload) is installed, the live test
  runs regardless of whether the scripting-pref or Claude-extension step reported
  a problem, so the bridge is proven end to end.
- **Explain the prompt.** The window says the macOS password prompt is for the
  After Effects helper.

This keeps the app's existing `osascript … with administrator privileges`
elevation (ADR-0004); only the ordering, atomicity and visibility change.

## Consequences

- A user who cannot supply an admin password cannot complete Setup — that is the
  intended trade: no silent half installs. (The running MCP still works without a
  loader via transport B; this ADR governs the *Setup* flow, not the MCP's
  ability to reach AE.)
- When the install aborts, files from a *previous* successful install are left in
  place; nothing new is written.
- The loader is now the gate for a "Setup succeeded" result.

## Alternatives considered

- **Roll back the user-level files on loader failure** — same end state, more
  code, and it deletes a payload that may already be working.
- **Keep the loader optional / drop it** — loses the heartbeat and with it the
  live test, so Setup can no longer verify anything.
- **Add a seventh "loader" checklist row** — works, but the loader *is* part of
  "Bridge installed"; folding it in keeps the six-row contract.

## Verification

- `RepairUninstallTests`: payload+loader both install (loader reported first); a
  loader failure leaves `bridge/` **absent** and returns only the loader row.
- `ChecklistTests`: a `bridge_loader` failure makes the "Bridge installed" row
  fail, carrying the loader's fix.
- `dotnet test`, then `npm run check` green.
- Manual: on a machine where the loader cannot be written, Setup reports a failed
  "Bridge installed" row and writes no payload.
