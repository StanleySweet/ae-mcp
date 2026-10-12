# User Guide

## Destructive operations

The following operations trigger an automatic incremental save before execution (when `incrementBeforeDestructive` is enabled, which is the default):

- Delete/remove operations and any operation that cannot be reversed with a single undo
- `layer.delete`
- `project.import_json` with `clearFirst`
- `project.save_as` onto an existing path
- Renders or exports onto an existing file
- Bulk plans that remove or replace items (e.g. `bulk.remove_unused`)
- `command.execute`
- `eval.run` (always destructive)

The guard makes one incremental save per call, per `batch.run`, and per bulk plan. The result includes `increment.incrementedFile` when an increment occurred. The saved project path is also surfaced by the next `check_setup` run (`project_saved_version` check).
