// Reorder a layer in its comp's stack (E16-5). The layer and the target are addressed the
// same way as every layer operation: index, exact name or {id} (aemcpRequireLayer).

// Moves a layer to the top, the bottom, or directly before/after another layer of the comp.
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layermovetobeginning
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layermovetoend
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layermovebefore
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layermoveafter
AEMCP.register('layer.move', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var layer = aemcpRequireLayer(comp, args);
    var to = args ? args.to : undefined;
    if (to !== 'top' && to !== 'bottom' && to !== 'before' && to !== 'after') {
        aemcpAbortArgs("to must be 'top', 'bottom', 'before' or 'after'");
    }
    if (to === 'top') {
        layer.moveToBeginning();
    } else if (to === 'bottom') {
        layer.moveToEnd();
    } else {
        if (args.target === undefined || args.target === null) {
            aemcpAbortArgs("target is required when to is 'before' or 'after'");
        }
        var target = aemcpRequireLayer(comp, { layer: args.target });
        if (target.index === layer.index) {
            aemcpAbortArgs('target must be a different layer than the one moved');
        }
        if (to === 'before') {
            layer.moveBefore(target);
        } else {
            layer.moveAfter(target);
        }
    }
    return aemcpLayerRef(layer);
});
