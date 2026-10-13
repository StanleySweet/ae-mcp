# User Guide

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
- `render.queue_start` — renders onto files that may already exist
- `bulk.remove_unused` — a bulk plan that removes or replaces items
- `eval.run` — arbitrary ExtendScript, always destructive and off unless explicitly enabled

The guard makes one incremental save per call, per `batch.run`, and per bulk plan — never
once per operation inside a batch. When an increment happens, the result carries
`increment.incrementedFile`, the path of the new versioned project file. The next
`check_setup` also names it through the `project_saved_version` check. If the project has
never been saved, the operation is refused with the error code `UNSAVED_PROJECT` and a hint
to save once first.
