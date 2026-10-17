// Render template names (E16-2), read in the user's AE language. Read-only: adds a temporary
// render queue item for one comp, reads its templates, and removes the item. Never renders.
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/rqitemcollection/
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/renderqueueitem/
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/renderqueueitem/#renderqueueitemoutputmodule
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/renderqueueitem/#renderqueueitemremove
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/outputmodule/#outputmoduletemplates

// The first composition in the project, used when no active comp is set.
function aemcpFirstComp() {
    var i, item;
    for (i = 1; i <= app.project.numItems; i++) {
        item = app.project.item(i);
        if (item instanceof CompItem) {
            return item;
        }
    }
    return null;
}

AEMCP.register('render.templates', function (args) {
    var key = aemcpCompKey(args);
    var comp = key ? aemcpRequireComp(key) : (aemcpResolveComp(null) || aemcpFirstComp());
    if (!comp) {
        aemcpAbortArgs('no composition to read render templates from');
    }
    var queue = app.project.renderQueue;
    var item = queue.items.add(comp);
    var outputModule, result;
    try {
        // RenderQueueItem.templates lists the Render Settings templates.
        // OutputModule.templates lists the Output Module templates.
        outputModule = item.outputModule(1);
        result = {
            outputModule: outputModule.templates,
            renderSettings: item.templates
        };
    } finally {
        item.remove();
    }
    return result;
});
