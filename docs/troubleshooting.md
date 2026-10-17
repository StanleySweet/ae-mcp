# Troubleshooting

Start with the `check_setup` tool in Claude. It returns six checks, each `ok`
or `fail` with a `fix` hint. Find the failing row below.

## check_setup results

### `after_effects` — fail

> Install After Effects 2025 or later.

No After Effects 2025 or newer install was found under `/Applications`. Install
it, then reopen Claude Desktop.

### `bridge_heartbeat` — fail

The bridge in After Effects has not reported in. The hint names the case:

- **missing** — *Open After Effects. If it persists, reinstall the bridge with Setup.*
  AE is not open, or the startup loader never ran.
- **stale** — *The bridge stopped reporting; restart After Effects.* The loader
  loaded but stopped; the heartbeat is older than 90 seconds.
- **unreadable** — *The heartbeat is unreadable; restart After Effects.*

After Effects must be open and the loader must have run (it runs at startup).
Quit and reopen After Effects; if it still fails, run Setup and click
**Install** to re-lay the bridge.

### `bridge_capabilities` — fail

The bridge payload installed in After Effects is older than the server: it does
not register some operation the server knows about, so `ae_do` would fail with
an unknown-operation error for it. The `fix` names the missing operation(s).

Refresh the bridge: run Setup and click **Install**, then restart After Effects
so the new payload loads.

### `bridge_version` — fail

The bridge that reported in the heartbeat is a different release than the
server (for example 1.4.0 against 1.4.1). `ae_do` results then carry a
`warning` line pointing here. The `fix` names both versions.

Run Setup to reinstall the bridge, then restart After Effects. Matching
release numbers pass; a `+revision` suffix on a development build is ignored.

### `queue_permissions` — fail

The `~/.ae-mcp` directory is missing or is not `chmod 700`.

> Queue directory must be chmod 700: `chmod 700 "<path>"`.

Run Setup to create the folders, or run the `chmod` the hint prints.

### `project_saved_version` — fail

The project has not been saved since ae-mcp last saw it, so the guard cannot
take a checkpoint before a destructive operation.

- **never saved** — *The project has never been saved; run a destructive
  operation or File > Save once.* Save once, then retry.
- **not a file** / **no longer exists on disk** — the recorded checkpoint path
  is gone; saving the project again fixes it.

## Tool errors

When a tool call fails, the result carries an `error.code`, a message and a
short `hint`. The codes and their hints:

| Code | Hint |
|------|------|
| `AE_NOT_RUNNING` | Launch After Effects, then retry. |
| `AE_BUSY` | After Effects runs another script. Close the panel running it, then retry. |
| `BRIDGE_NOT_LOADED` | Restart After Effects so the bridge loads, then retry. |
| `UNKNOWN_TOOL` | Call `ae_catalog` to list the operations. |
| `INVALID_MESSAGE` | Client and server protocol differ; restart the client. |
| `INVALID_ARGS` | Call `ae_describe` for the operation's schema. |
| `FORBIDDEN` | Adjust `~/.ae-mcp/settings.json` or the environment override. |
| `UNSAVED_PROJECT` | Save the project once (File > Save), then retry. |
| `SCRIPT_ERROR` | See Window > Console in After Effects. |
| `TIMEOUT` | The job passed its deadline and was cancelled. |
| `UNKNOWN_JOB` | Poll `job_status` with the id from the start call. |
| `AERENDER_NOT_FOUND` | Install After Effects so aerender is available. |
| `UNKNOWN_PLAN` | Call `ae_plan` again for a fresh `planId`. |
| `PLAN_EXPIRED` | Plans expire after 10 minutes; call `ae_plan` again. |
| `PLAN_CHANGED` | The project changed since the plan; call `ae_plan` again. |
| `DIALOG_OPEN` | Dismiss the dialog with `ae_dialogs`, then retry. |

The longer explanation of each code is served once as the MCP resource
`ae-mcp://error-hints` (JSON, code to text).

An `INVALID_ARGS` or `UNKNOWN_TOOL` error can carry `details`: `arg` (the argument
at fault), `expected`, `allowed` (the valid enum values) and `closest` (a likely
intended operation or property match name). `closest` is left out when nothing is
close. Retry with the suggested name instead of repeating the same input.

The two most common: `AE_NOT_RUNNING` (After Effects is closed) and
`BRIDGE_NOT_LOADED` (AE is open but the startup loader has not run — restart
AE). Both point at the same thing the `bridge_heartbeat` check verifies.

## Setup checks

The AE-MCP Setup app shows six rows. A row that says **Fix** prints what to do;
a few of them in full:

| Row | Fix |
|-----|-----|
| After Effects found | Install After Effects, then reopen Setup. |
| Claude Desktop found | Install Claude Desktop from https://claude.ai/download and sign in. |
| Claude extension | Accept the install prompt, or use Settings > Extensions > Advanced > Install extension and pick `ae-mcp.mcpb`. |
| Test | A live round-trip through the bridge; fails if AE is not open or the bridge is stale. |

**Bridge installed** and **Scripting permission** repair themselves when you
click **Install**; **Claude extension** additionally needs Claude Desktop open
so it can show the install prompt.

## Claude does not list the ae-mcp tools

1. Confirm the extension is installed in Claude Desktop (**Settings >
   Extensions**).
2. Open After Effects. The bridge only reports while AE is running.
3. Run `check_setup` and fix any failing row above.
