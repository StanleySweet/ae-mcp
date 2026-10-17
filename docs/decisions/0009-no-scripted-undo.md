# ADR-0009: Never undo by script

Date: 2026-10-17
Status: Accepted
Authors: Claude
Decider: Claude, under Stan's standing instruction to fix live-drive failures
Supersedes: the rollback half of ADR-0008
References: #195, #258, #259

## Context

Every scripted Edit > Undo (`app.executeCommand(16)`) makes After Effects 26.5 raise a
modal warning, "Undo group mismatch, will attempt to fix" (fr: "annuler la
non-concordance de groupe, tentative de correction"). The modal blocks every later
bridge job. We hit it three ways:

- the Setup app's live test (`comp.create` then `project.undo`, #195);
- batch rollback run inside the batch script (#189);
- batch rollback run as a separate `project.undo` job (#258).

#195 and #258 each moved the Undo but never confirmed live that the dialog was gone.

## Decision

- No ae-mcp code runs Edit > Undo.
- `project.undo` is removed.
- `batch.run` still computes whether the batch changed the project (`rollback: true`),
  but nothing undoes it. The server strips the flag and appends to the error: the
  earlier steps are still applied, and a single Cmd+Z in After Effects reverts the
  whole batch (it is one undo group).
- The Setup app's live test is a read-only `project.info` round trip.

## Consequences

- A failed batch leaves its earlier steps applied until the user presses Cmd+Z once.
- Claude cannot undo for the user. Checkpoints (`checkpoint_revert`) remain the way
  back for larger changes.

## Verification

- Live test drive on AE 26.5 with no dialog.
- Unit tests:
  - the server never calls an undo;
  - the error tells the user to press Cmd+Z.
