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
- `queue_permissions` — `~/.ae-mcp` is `chmod 700`.
- `project_saved_version` — the project has been saved at least once (see
  [Destructive operations](#destructive-operations)).
- `third_party_extensions` — informational: the CEP extensions found (for
  example Animation Composer or Motion), in its `detail`. Always `ok`.

Any failing check carries a `fix` hint. When the five gating checks are green,
ask Claude to list the tools it can see.

On connect the server also sends Claude its animation principles (keyframes vs
expressions, naming, easing, safety), so motion edits follow one consistent
ruleset without you pasting any context.

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
- `command.execute` — runs an arbitrary menu command
- `bulk.remove_unused` — a bulk plan that removes or replaces items
- `eval.run` — arbitrary ExtendScript, always destructive and off unless explicitly enabled

The guard makes one incremental save per call, per `batch.run`, and per bulk plan — never
once per operation inside a batch. When an increment happens, the result carries
`increment.incrementedFile`, the path of the new versioned project file. The next
`check_setup` also names it through the `project_saved_version` check. If the project has
never been saved, the operation is refused with the error code `UNSAVED_PROJECT` and a hint
to save once first.

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
