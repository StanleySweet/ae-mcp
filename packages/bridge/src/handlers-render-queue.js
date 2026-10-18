// Render queue cleanup (E16-6): remove one queue item by index, or every item.

// Removes the render queue item at `index` (1-based), or every item when all is true.
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/renderqueueitem/#renderqueueitemremove
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/rqitemcollection/
AEMCP.register('render.queue_remove', function (args) {
    var queue = app.project.renderQueue;
    var removed = 0;
    if (args && args.all === true) {
        // Last to first, so each removal leaves the lower indices where they were.
        for (var i = queue.numItems; i >= 1; i--) {
            queue.item(i).remove();
            removed++;
        }
    } else {
        if (!args || typeof args.index !== 'number') {
            aemcpAbortArgs('index is required (or pass all: true)');
        }
        var item = queue.item(args.index);
        if (!item) {
            aemcpAbortArgs('render queue item not found: ' + args.index);
        }
        item.remove();
        removed = 1;
    }
    return { removed: removed, numItems: queue.numItems };
});
