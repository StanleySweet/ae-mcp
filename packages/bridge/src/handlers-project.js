// Project-level operations that live outside handlers.js.

// Open a fresh untitled project. Refuses while the open project has unsaved
// changes unless force: true, so AE never shows a save prompt. Forcing closes the
// current project without saving first (the same pattern project.open uses).
// Ref: https://ae-scripting.docsforadobe.dev/general/application/#appnewproject
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectdirty
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectclose
AEMCP.register('project.new', function (args) {
    var force = args && args.force === true;
    // AE reports a fresh untitled project as dirty; with no file and no items
    // there is nothing to lose (the same rule as increment_save, #204).
    var emptyUntitled = !app.project.file && app.project.numItems === 0;
    if (!force && !emptyUntitled && app.project.dirty !== false) {
        aemcpAbortArgs('the open project has unsaved changes: save it or pass force: true');
    }
    if (force || emptyUntitled) {
        app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    }
    var created = app.newProject();
    if (!created) {
        aemcpAbortArgs('could not create a new project');
    }
    return { numItems: app.project.numItems };
});
