// Keyframe clearing, layer timing and source replacement (#286).
// ES3 only (ExtendScript).

// Parse an optional finite number argument; undefined when absent.
function aemcpOptionalNumber(args, name) {
    var value = args ? args[name] : undefined;
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !isFinite(value)) {
        aemcpAbortArgs(name + ' must be a finite number (seconds)');
    }
    return value;
}

// Remove every key of a property, or only the keys whose time is in [from, to].
// Keys are removed from the last to the first, since indexes shift after each removal.
// When every key goes, the property keeps the value it had at the comp time.
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertynumkeys
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertykeytime
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyremovekey
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyvalueattime
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysetvalue
AEMCP.register('keyframe.clear', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var layer = aemcpRequireLayer(comp, args);
    if (!args || typeof args.property !== 'string' || args.property === '') {
        aemcpAbortArgs('property is required');
    }
    var from = aemcpOptionalNumber(args, 'from');
    var to = aemcpOptionalNumber(args, 'to');
    var prop = aemcpResolveProperty(layer, args.property);
    if (!prop || aemcpIsGroup(prop)) {
        aemcpAbortPropertyNotFound(layer, args.property, 'property not found: ' + args.property);
    }
    var total = prop.numKeys;
    var keptValue = null;
    var removed = 0;
    var j, t;
    if (total > 0 && !prop.expressionEnabled) {
        keptValue = prop.valueAtTime(comp.time, false);
    }
    for (j = total; j >= 1; j--) {
        t = prop.keyTime(j);
        if ((from === undefined || t >= from) && (to === undefined || t <= to)) {
            prop.removeKey(j);
            removed++;
        }
    }
    if (keptValue !== null && prop.numKeys === 0) {
        prop.setValue(keptValue);
    }
    return { index: layer.index, name: layer.name, property: args.property, removed: removed, remaining: prop.numKeys };
});

// Start time, in point and out point of a layer, in seconds of comp time.
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerstarttime
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerinpoint
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layeroutpoint
AEMCP.register('layer.set_timing', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var layer = aemcpRequireLayer(comp, args);
    var startTime = aemcpOptionalNumber(args, 'startTime');
    var inPoint = aemcpOptionalNumber(args, 'inPoint');
    var outPoint = aemcpOptionalNumber(args, 'outPoint');
    if (startTime === undefined && inPoint === undefined && outPoint === undefined) {
        aemcpAbortArgs('pass at least one of startTime, inPoint, outPoint');
    }
    var newIn = inPoint !== undefined ? inPoint : layer.inPoint;
    var newOut = outPoint !== undefined ? outPoint : layer.outPoint;
    if (newOut <= newIn) {
        aemcpAbortArgs('outPoint must be after inPoint');
    }
    if (startTime !== undefined) layer.startTime = startTime;
    if (inPoint !== undefined) layer.inPoint = inPoint;
    if (outPoint !== undefined) layer.outPoint = outPoint;
    return { index: layer.index, name: layer.name, startTime: layer.startTime, inPoint: layer.inPoint, outPoint: layer.outPoint };
});

// Swap the source of an AV layer for a footage or comp item, given by name or id.
// Ref: https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayerreplacesource
AEMCP.register('layer.replace_source', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var layer = aemcpRequireLayer(comp, args);
    if (!args || (typeof args.item !== 'string' && typeof args.item !== 'number') || args.item === '') {
        aemcpAbortArgs('item is required: pass the footage or comp name, or its id');
    }
    if (!(layer instanceof AVLayer)) {
        aemcpAbortArgs('layer ' + layer.index + ' has no source (it is not an AV layer)');
    }
    var item = aemcpFindItem(args.item);
    if (!item) {
        aemcpAbortArgs('item not found: ' + args.item);
    }
    if (!(item instanceof CompItem || item instanceof FootageItem)) {
        aemcpAbortArgs('item must be a footage or composition item: ' + args.item);
    }
    var fix = args.fixExpressions === true;
    layer.replaceSource(item, fix);
    return { index: layer.index, name: layer.name, source: item.name, fixExpressions: fix };
});
