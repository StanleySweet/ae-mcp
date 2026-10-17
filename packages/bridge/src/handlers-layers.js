// Layer handlers that are not part of the original handlers.js (#215).

// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerisnameset (assigning name marks it as set explicitly)
AEMCP.register('layer.rename', function (args) {
    var name = args ? args.name : undefined;
    if (typeof name !== 'string' || name === '') {
        aemcpAbortArgs('name must be a non-empty string');
    }
    var comp = aemcpRequireComp(args && args.comp);
    var layer = comp.layer(args.index);
    if (!layer) {
        aemcpAbortArgs('layer not found: ' + args.index);
    }
    layer.name = name;
    return { index: layer.index, name: layer.name };
});
