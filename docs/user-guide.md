# User Guide

ae-mcp connects Claude Desktop to the After Effects project you have open, so
Claude can read and edit it. macOS only, After Effects 2025 and later. The
versions that have been run against are listed in
[`tested-versions.md`](tested-versions.md).

## Install

### 1. Open the Setup app past Gatekeeper

The ae-mcp builds are unsigned, so macOS blocks the first launch. Open the
`.dmg`, drag **AE-MCP Setup** into Applications, then right-click (or
Control-click) the app and choose **Open**, and click **Open** again in the
warning dialog. You only do this once; afterwards it opens normally with a
double-click.

If macOS says the app is damaged or still refuses to open it, double-click
**If Setup will not open.command** in the dmg window. It clears the download
quarantine with `xattr -cr "/Applications/AE-MCP Setup.app"`. The script is
unsigned too, so macOS may ask you to confirm it the same way; you can also paste
that command into Terminal yourself.

### 2. Run Setup

AE-MCP Setup shows six checks. It detects After Effects and Claude Desktop, then
installs the rest:

- **After Effects found** — an AE 2025 or newer install was detected.
- **Claude Desktop found** — `/Applications/Claude.app` is present.
- **Bridge installed** — the ExtendScript payload is in `~/.ae-mcp/bridge` and
  the startup loader is in the AE `Scripts/Startup` folder.
- **Scripting permission** — the AE preference that allows scripts to run is on.
- **Claude extension** — the `ae-mcp.mcpb` bundle is handed to Claude Desktop,
  which shows its install prompt.
- **Test** — a live round-trip through the bridge.

Click **Install**. Any row that still shows **Fix** explains what to do; click
**Retry** after you have done it.

### 3. Restart After Effects

The startup loader only runs when AE starts, so quit and reopen After Effects
once. The bridge then sends a heartbeat every 30 seconds for as long as AE is
open — AE must be open for Claude to reach your project.

### 4. Add the Claude extension

Setup hands `ae-mcp.mcpb` to Claude Desktop, which shows an install prompt;
accept it. If nothing appears, open Claude Desktop, go to
**Settings > Extensions > Advanced > Install extension** and pick `ae-mcp.mcpb`.

## First run

With AE open, ask Claude to run the `check_setup` tool. It reports six checks:

- `after_effects` — an AE 2025+ install was found.
- `bridge_heartbeat` — the bridge reported in recently (AE is open and loaded).
- `bridge_capabilities` — the installed bridge payload reports every operation the
  server knows. Fails when the payload is out of date, naming the missing
  operation(s) and the fix (refresh the bridge, then restart After Effects).
- `bridge_version` — the bridge reports the same release as the server. Fails on
  a mismatch and names both versions; `ae_do` adds a `warning` in that case.
- `queue_permissions` — `~/.ae-mcp` is `chmod 700`.
- `project_saved_version` — the project has been saved at least once (see
  [Destructive operations](#destructive-operations)).
- `third_party_extensions` — informational: the CEP extensions found (for
  example Animation Composer or Motion), in its `detail`. Always `ok`.
- `extension_update` — informational: compares the server with the latest GitHub
  release. Its `detail` says `update available` with the release URL when a newer
  one exists. Always `ok`; offline it says the check was unavailable. The lookup is
  cached for a day under `~/.ae-mcp`. Set `AE_MCP_NO_UPDATE_CHECK=1` to turn it off
  (the row is then omitted and nothing is fetched).

Any failing check carries a `fix` hint. When the five gating checks are green,
ask Claude to list the tools it can see.

On connect the server also sends Claude a short core of its animation principles
(keyframes vs expressions, naming, easing, safety) as the MCP instructions, so
motion edits follow one consistent ruleset without you pasting any context. The
full text is the MCP resource `ae-mcp://animation-principles`; clients that read
resources can load it for the reasoning behind each rule.

## Using ae-mcp from Cursor

Cursor reads MCP servers from `.cursor/mcp.json` in a project, or `~/.cursor/mcp.json`
for every project. Point it at the installed server:

```json
{
  "mcpServers": {
    "ae-mcp": {
      "command": "node",
      "args": ["<path to installed server>/server/index.js"]
    }
  }
}
```

The installed server is one of:

- The Claude Desktop extension that Setup installed:
  `~/Library/Application Support/Claude/Claude Extensions/<id>/server/index.js`. Find
  `<id>` as the folder whose `manifest.json` has `"name": "ae-mcp"`.
- This repo, after `npm run bundle:pack`: `dist/staging/server/index.js`.

Cursor is a GUI app and may not see the `node` on your shell `PATH`. If it cannot start
the server, put the full path from `which node` in `command`.

## Using ae-mcp from Claude Code

```sh
claude mcp add ae-mcp -- node "<path to installed server>/server/index.js"
```

The path is the same as for Cursor above.

## Uninstall

Open AE-MCP Setup and click **Uninstall**. It removes the bridge payload, the
startup loader and the saved-version marker. Remove the extension itself in
Claude Desktop under **Settings > Extensions**.

## Diagnostics

Click **Export diagnostics** in Setup to write a report to
`~/Desktop/ae-mcp-diagnostics.txt`. It lists the detected AE and Claude
installs and the paths ae-mcp uses, which is what to attach to a bug report.

## Destructive operations

Some operations delete, replace or overwrite project data, or make a change that a single
undo cannot reverse. Before any of them runs, ae-mcp saves a checkpoint with File > Increment
and Save, so the file on disk keeps the state from just before the change
(`MyProject_v007.aep` becomes `MyProject_v008.aep`).

The guard is on when `incrementBeforeDestructive` is enabled, which is the default. The
setting is owned by the Setup app and Claude cannot change it; the environment variable
`AE_MCP_INCREMENT_BEFORE_DESTRUCTIVE` overrides it.

Operations flagged destructive:

- `layer.delete`, `keyframe.remove`, `effect.remove` — deletes and removals
- `project.open` — replaces the open project; refuses unless `force: true` when the open project has unsaved changes (or that cannot be told)
- `command.execute` — runs an arbitrary menu command
- `bulk.remove_unused` — a bulk plan that removes or replaces items
- `eval.run` — arbitrary ExtendScript, always destructive and off unless explicitly enabled

The guard makes one incremental save per call, per `batch.run`, and per bulk plan — never
once per operation inside a batch. When an increment happens, the result carries
`increment.incrementedFile`, the path of the new versioned project file. The next
`check_setup` also names it through the `project_saved_version` check. If the project has
never been saved, the operation is refused with the error code `UNSAVED_PROJECT` and a hint
to save once first.

## Comparing frames

`ae_render_frame` takes an optional `compareWith`: the path of an earlier frame that
ae-mcp rendered into its render folder (`~/.ae-mcp/render`, the `file` field of the
earlier result). The new frame is compared with it and the metadata gains a `compare`
block:

- `changedPercent` — share of pixels where some colour channel moved by more than 8 (0-100)
- `meanDelta` — mean absolute channel difference over all pixels (0-255)
- `bbox` — `[x, y, width, height]` around the changed pixels, or `null` when none changed

Frames of different sizes report `changedPercent: 100` with `note: "size differs"`. The
comparison uses macOS `sips` to decode the PNGs, so it only runs on macOS. A `compareWith`
path outside the render folder, or one that does not exist, is refused with `INVALID_ARGS`.

## Checkpoints

A checkpoint is a named restore point: the versioned project file that File > Increment and
Save writes. Checkpoints are stored in `~/.ae-mcp/checkpoints.json`.

- `checkpoint_create {name}` saves the open project with Increment and Save and records the
  new file under `name`. The name is 1-64 characters: letters, digits, spaces, `_` and `-`.
  Reusing a name replaces the old entry; the old file stays on disk. The project must have
  been saved once already (`UNSAVED_PROJECT` otherwise).
- `checkpoint_list` returns the checkpoints, newest first.
- `checkpoint_revert {name}` is destructive. It first runs Increment and Save so the current
  state is kept as a version, then reopens the checkpoint's file (with `force`). It is
  refused in read-only mode, and so is `checkpoint_create`, because both save the project.

## Expression-driven properties

A property whose value comes from an expression (for example one added by a preset, or a
`wiggle`) ignores a direct value or keyframe edit: the expression is the real driver. When
`ae_do` runs `property.set`, `keyframe.add`, `keyframe.remove`, `keyframe.set_easing`,
`keyframe.ease_preset`, `anchor.move_preserving`, `effect.set_property` or `effect.set_keyframe` against such a property, the result carries a
`warning` naming the property and the expression, so Claude can edit the driving control
instead. `ae_expression_report` lists every expression-driven property on a comp's layers.
`expression.snippet` applies a named expression snippet (`wiggle`, `loop`, `delay`,
`overshoot`) to a property by setting `Property.expression` directly.
`rig.null_controller` builds a controller rig in one step: it creates a null, adds a
Slider Control effect per requested slider name, and parents the given layers to the
null.


## Modal dialogs

A dialog open in After Effects blocks every script, so calls would only time out. When a
call times out and a dialog is open, the error is `DIALOG_OPEN` and carries the dialog's
title and text. `ae_dialogs` with `action: "list"` (the default) shows the open dialogs;
`action: "dismiss"` presses the frontmost dialog's Cancel button, or Escape when it has
none. It never presses Save or Don't Save, so it cannot save or lose work.

This needs the Accessibility permission for the app that runs the MCP server (for
example Claude Desktop): System Settings > Privacy & Security > Accessibility. Without
it `ae_dialogs` returns that instruction, and timeouts keep their usual message.

## Running ExtendScript (eval.run)

`eval.run` runs arbitrary ExtendScript inside After Effects, so it is off by default. A
client that can call it can do anything AE can do. Leave it off unless you need it.

To enable it, set `evalEnabled` in `~/.ae-mcp/settings.json`:

```json
{ "evalEnabled": true }
```

or set `AE_MCP_EVAL_ENABLED=1` in the environment that starts the server. Then restart
the MCP client (Claude Desktop, Cursor or Claude Code).

Rules that always apply:

- It is always destructive: ae-mcp makes an incremental save (File > Increment and Save)
  before each call, so the project must have been saved once. See
  [Destructive operations](#destructive-operations).
- It is refused in read-only mode (`AE_MCP_READ_ONLY=1` or `readOnly: true`).
- While it is off, `ae_catalog` does not list it and `ae_do` returns `FORBIDDEN`.

Call it through `ae_do` with `op: "eval.run"` and `args: { code: "..." }`. The code runs
in After Effects inside one undo group, so Edit > Undo reverts it. The result is
`{ result: value }`, where `value` is the value of the code's last expression:

- `null`, booleans, numbers and strings come back as they are.
- Arrays and objects come back as JSON when they can be serialised.
- Anything else (`undefined`, functions, cyclic objects) comes back as its string form.

Empty `code` returns `INVALID_ARGS`. An exception thrown by the code returns
`SCRIPT_ERROR` with its message.

## Tool details

Short descriptions ship with each tool. The details below were removed from them to save tokens.

- `ae_render_frame`: a frame larger than `maxEdge` (default 1568) is downscaled so its longest edge is `maxEdge`. `compareWith` must be a previous frame inside the render folder and adds `compare: {changedPercent, meanDelta, bbox}`.
- `ae_render`: exactly one of `comp` or `rqindex`. Never overwrites an existing `output`.
- `ae_dialogs`: `list` returns each open dialog's title and text. `dismiss` presses Cancel or Escape on the frontmost dialog and never Save or Don't Save. Needs Accessibility permission for the MCP client.
- `ae_plan` and `ae_apply`: only operations in the `bulk` category can be planned. A plan expires after 10 minutes and is refused if the project changed since it was made.
- `checkpoint_create`: the name is 1-64 characters of letters, digits, space, `_` or `-`. Reusing a name replaces it.
- `checkpoint_revert`: runs File > Increment and Save first, so the current state is kept as a version.

## Test drive

`npm run test:drive` takes the open After Effects for a spin: it starts the server
in-process and calls every MCP tool and every `ae_do` operation once, as Claude would.
It is a manual gate (never run in CI) and needs After Effects open with the bridge
installed. Pass `--keep` (`npm run test:drive -- --keep`) to leave the scratch items.

The drive works in its own scratch project, never in yours. It refuses to start while
the open project has unsaved changes (exit code 2, nothing changed). Otherwise it runs
`project.new`, saves the scratch project to `.tmp/test-drive/drive.aep`, and at the end
reopens the project that was open before, if there was one. Renders and copies go to
`.tmp/test-drive`. It never uses `eval.run` or `command.execute`, and
runs `bulk.remove_unused` as a dry-run plan only. `batch.run` includes one deliberate
failing step to exercise rollback (Edit > Undo). The scratch items are removed at the end.

Output: a live checklist in the terminal and `.tmp/test-drive/report.html` with counts,
a per-category table, errors and the rendered frames. Exit code 1 when a step failed.
The scenario is `scripts/test-drive/scenario.ts`; `coverage.test.ts` fails CI when a new
tool or operation has no step or explicit skip.
