# Troubleshooting

Start with the `check_setup` tool in Claude. It returns four checks, each `ok`
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
`hint`. The codes and their hints:

| Code | Hint |
|------|------|
| `AE_NOT_RUNNING` | Launch After Effects, then retry. |
| `BRIDGE_NOT_LOADED` | Restart After Effects so the startup loader runs, then retry. |
| `UNKNOWN_TOOL` | Call `ae_catalog` to list the available tools. |
| `INVALID_MESSAGE` | Client and server protocol versions differ; restart the client after upgrading. |
| `INVALID_ARGS` | Check the tool description for the expected arguments. |
| `FORBIDDEN` | Adjust `~/.ae-mcp/settings.json` or the environment override. |
| `UNSAVED_PROJECT` | Save the project once (File > Save) so Increment and Save can version it. |
| `SCRIPT_ERROR` | Open Window > Console in After Effects for the script error. |
| `TIMEOUT` | The job exceeded its deadline and was cancelled. |
| `UNKNOWN_JOB` | Poll `job_status` with the id returned when the job started. |
| `AERENDER_NOT_FOUND` | Install After Effects so its aerender executable is available. |
| `UNKNOWN_PLAN` | Call `ae_plan` again to preview the change and get a fresh `planId`. |
| `PLAN_EXPIRED` | Plans expire after 10 minutes; call `ae_plan` again and apply right away. |
| `PLAN_CHANGED` | The project changed since the plan was made; call `ae_plan` again to re-preview. |

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
