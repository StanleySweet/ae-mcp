// Verification ops (#216): a compact comp snapshot, a diff against an earlier
// snapshot, and property sampling at given times. All read-only.
// ES3 only (ExtendScript).

// Read one transform value, or null when AE refuses it (try/catch per value).
function aemcpVerifyTransformValue(transform, matchName) {
    try {
        var prop = transform.property(matchName);
        if (!prop || aemcpIsGroup(prop)) {
            return null;
        }
        return aemcpCoerceValue(prop.value);
    } catch (e) {
        return null;
    }
}

// Match names of transform properties that carry an enabled expression.
function aemcpVerifyExpressionNames(transform) {
    var names = [];
    var list = [AEMCP_MATCH.ANCHOR_POINT, AEMCP_MATCH.POSITION, AEMCP_MATCH.SCALE, AEMCP_MATCH.ROTATION, AEMCP_MATCH.OPACITY];
    var i, prop;
    for (i = 0; i < list.length; i++) {
        try {
            prop = transform.property(list[i]);
            // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyexpressionenabled
            if (prop && !aemcpIsGroup(prop) && prop.expressionEnabled) {
                names.push(list[i]);
            }
        } catch (e) {
            // A property AE will not report on is simply left out.
        }
    }
    return names;
}

// Match names of the effects on a layer, in stack order.
function aemcpVerifyEffectNames(layer) {
    var names = [];
    var parade = layer.property(AEMCP_MATCH.EFFECTS);
    var i;
    if (!aemcpIsGroup(parade)) {
        return names;
    }
    for (i = 1; i <= parade.numProperties; i++) {
        names.push(parade.property(i).matchName);
    }
    return names;
}

function aemcpVerifyLayer(layer) {
    var transform = layer.property(AEMCP_MATCH.TRANSFORM);
    var hasTransform = aemcpIsGroup(transform);
    return {
        index: layer.index,
        name: layer.name,
        type: aemcpLayerType(layer),
        // Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerinpoint
        inPoint: aemcpRound(layer.inPoint),
        // Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layeroutpoint
        outPoint: aemcpRound(layer.outPoint),
        // Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerparent
        parentIndex: layer.parent ? layer.parent.index : null,
        // Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerenabled
        enabled: layer.enabled,
        transform: {
            anchorPoint: hasTransform ? aemcpVerifyTransformValue(transform, AEMCP_MATCH.ANCHOR_POINT) : null,
            position: hasTransform ? aemcpVerifyTransformValue(transform, AEMCP_MATCH.POSITION) : null,
            scale: hasTransform ? aemcpVerifyTransformValue(transform, AEMCP_MATCH.SCALE) : null,
            rotation: hasTransform ? aemcpVerifyTransformValue(transform, AEMCP_MATCH.ROTATION) : null,
            opacity: hasTransform ? aemcpVerifyTransformValue(transform, AEMCP_MATCH.OPACITY) : null
        },
        effects: aemcpVerifyEffectNames(layer),
        expressions: hasTransform ? aemcpVerifyExpressionNames(transform) : []
    };
}

function aemcpVerifySnapshot(comp) {
    var layers = [];
    var i;
    for (i = 1; i <= comp.numLayers; i++) {
        layers.push(aemcpVerifyLayer(comp.layer(i)));
    }
    return { comp: comp.name, layers: layers };
}

// Deep equality for snapshot values: numbers within 1e-6, arrays and objects
// element by element, everything else strictly.
function aemcpVerifyEqual(a, b) {
    var key, count = 0;
    if (typeof a === 'number' && typeof b === 'number') {
        return Math.abs(a - b) <= 1e-6;
    }
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        return a === b;
    }
    if (a instanceof Array || b instanceof Array) {
        if (!(a instanceof Array) || !(b instanceof Array) || a.length !== b.length) {
            return false;
        }
        for (key = 0; key < a.length; key++) {
            if (!aemcpVerifyEqual(a[key], b[key])) {
                return false;
            }
        }
        return true;
    }
    for (key in a) {
        if (a.hasOwnProperty(key)) {
            count++;
            if (!b.hasOwnProperty(key) || !aemcpVerifyEqual(a[key], b[key])) {
                return false;
            }
        }
    }
    for (key in b) {
        if (b.hasOwnProperty(key)) {
            count--;
        }
    }
    return count === 0;
}

// Flatten a layer snapshot into comparable fields, e.g. 'transform.opacity'.
function aemcpVerifyFields(layer) {
    var fields = {
        type: layer.type,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        parentIndex: layer.parentIndex,
        enabled: layer.enabled,
        effects: layer.effects,
        expressions: layer.expressions
    };
    var keys = ['anchorPoint', 'position', 'scale', 'rotation', 'opacity'];
    var i;
    for (i = 0; i < keys.length; i++) {
        fields['transform.' + keys[i]] = layer.transform ? layer.transform[keys[i]] : null;
    }
    return fields;
}

AEMCP.register('comp.snapshot', function (args) {
    var comp = aemcpRequireComp(args && args.comp);
    return aemcpVerifySnapshot(comp);
});

AEMCP.register('comp.diff', function (args) {
    var comp = aemcpRequireComp(args && args.comp);
    var previous = args ? args.snapshot : null;
    if (!previous || typeof previous !== 'object' || !(previous.layers instanceof Array)) {
        aemcpAbortArgs('snapshot with a layers array is required');
    }
    var current = aemcpVerifySnapshot(comp).layers;
    var old = previous.layers;
    var added = [];
    var removed = [];
    var changed = [];
    var matchedOld = [];
    var i, j, found, fieldsNow, fieldsBefore, fields, key;

    for (i = 0; i < current.length; i++) {
        found = null;
        for (j = 0; j < old.length; j++) {
            if (old[j] && old[j].index === current[i].index && old[j].name === current[i].name) {
                found = old[j];
                matchedOld[j] = true;
                break;
            }
        }
        if (!found) {
            added.push(current[i].name);
            continue;
        }
        fieldsNow = aemcpVerifyFields(current[i]);
        fieldsBefore = aemcpVerifyFields(found);
        fields = [];
        for (key in fieldsNow) {
            if (fieldsNow.hasOwnProperty(key) && !aemcpVerifyEqual(fieldsBefore[key], fieldsNow[key])) {
                fields.push({ field: key, before: fieldsBefore[key], after: fieldsNow[key] });
            }
        }
        if (fields.length > 0) {
            changed.push({ index: current[i].index, name: current[i].name, fields: fields });
        }
    }
    for (j = 0; j < old.length; j++) {
        if (old[j] && !matchedOld[j]) {
            removed.push(old[j].name);
        }
    }
    return { added: added, removed: removed, changed: changed };
});

AEMCP.register('property.sample', function (args) {
    var comp = aemcpRequireComp(args && args.comp);
    var times = args ? args.times : null;
    var i, layer, prop, value, samples = [];
    layer = aemcpRequireLayer(comp, args);
    if (!args || typeof args.property !== 'string' || args.property === '') {
        aemcpAbortArgs('property is required');
    }
    if (!(times instanceof Array) || times.length === 0) {
        aemcpAbortArgs('times must be a non-empty array of numbers');
    }
    for (i = 0; i < times.length; i++) {
        if (typeof times[i] !== 'number' || !isFinite(times[i])) {
            aemcpAbortArgs('times must be a non-empty array of numbers');
        }
    }
    prop = aemcpResolveProperty(layer, args.property);
    if (!prop || aemcpIsGroup(prop)) {
        aemcpAbortPropertyNotFound(layer, args.property, 'property not found: ' + args.property);
    }
    for (i = 0; i < times.length; i++) {
        // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyvalueattime
        value = prop.valueAtTime(times[i], false);
        samples.push({ time: times[i], value: aemcpCoerceValue(value) });
    }
    return { samples: samples };
});
