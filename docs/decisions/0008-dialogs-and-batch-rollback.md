# ADR-0008: Modal-dialog handling and batch rollback

Date: 2026-10-17
Status: Accepted
Authors: Claude
Decider: Claude, delegated by Stan ("file 1-7 in gh then tackle them, feel free to plan")
References: #188, #189; competitor survey in JOURNAL.md 2026-10-17

## Context

- A modal dialog in After Effects blocks every script, so ae-mcp calls only time out.
  Two competing servers detect the dialog and can close it.
- `batch.run` stops at a failed step but keeps the steps before it applied, so a
  failed batch leaves the project half-changed.

## Decision

**Dialogs (#188).** The server, not the bridge, handles dialogs: the bridge cannot run
while a dialog is up. It reads AE's windows through System Events (`osascript`), which
needs macOS Accessibility permission for the MCP client process. A timeout or stall
that finds a dialog is reported as the new `DIALOG_OPEN` error carrying the dialog
text. `ae_dialogs {action: 'list'|'dismiss'}` lists dialogs or presses the frontmost
dialog's Cancel button (Escape when it has none). It never presses Save or Don't Save,
so it cannot lose or overwrite work. Without the permission the tool returns the fix,
and timeouts keep today's message.

**Rollback (#189).** `batch.run` takes `atomic` (default true). On a failed step, the
bridge closes the batch's single undo group and runs Edit > Undo once
(`app.executeCommand(16)`). It does this only when a step marked mutating succeeded
before the failure. The server sends that per-step `mutating` flag from the
registry's `readOnly`, so an all-read-only prefix never undoes the user's own previous
action. `atomic: false` keeps stop-and-keep.

## Consequences

- Dialog features depend on a permission the user grants once. The docs say how.
- A mutating step that changed nothing still counts as mutating. In that rare case the
  undo reverts the user's previous action. Accepted: every mutating handler today
  makes a change or fails.

## Alternatives considered

- Bridge-side dialog checks: impossible, because the bridge is blocked by the dialog.
- Project checkpoints (save a copy, revert to it) for rollback: heavier, it touches the
  user's files, and incremental save already versions the project.

## Verification

Unit tests with canned System Events output (#188) and a mock undo stack (#189). Live
check on AE 26.5 after merge.
