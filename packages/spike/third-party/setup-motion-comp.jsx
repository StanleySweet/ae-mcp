/*
 * E14-1 spike helper: build a clean single-layer comp for the Motion test.
 *
 * Run inside After Effects (File > Scripts > Run Script File...). It adds a new
 * comp "MOTION TEST" with one solid layer "MOTION TARGET" and opens it, so a
 * Motion 2 tool can be applied to that layer and the before/after reports diffed.
 *
 * Non-destructive: only adds to the current project, never saves it.
 *
 * API refs:
 *   https://ae-scripting.docsforadobe.dev/item/projectitemcollection/#addcomp
 *   https://ae-scripting.docsforadobe.dev/item/compitem/#layers
 */
(function () {
  var project = app.project;
  if (!project) {
    return;
  }
  app.beginUndoGroup("ae-mcp motion spike setup");
  var comp = project.items.addComp("MOTION TEST", 1920, 1080, 1, 5, 25);
  comp.layers.addSolid([1, 0.5, 0.2], "MOTION TARGET", 1920, 1080, 1, 5);
  comp.openInViewer();
  app.endUndoGroup();
})();
