// Observe handlers: read-only tools that serialize the open project.
// Registered into the heartbeat capabilities via AEMCP.register.
AEMCP.register('ae_project_info', function () {
    return AEMCP.serialize.project();
});

// Project operation handlers (mutating, run via ae_do).
AEMCP.register('project.info', function () {
    var project = app.project;
    return AEMCP.serialize.project();
});

AEMCP.register('project.undo', function () {
    app.project.undo();
    return { success: true };
});

// Comp operation handlers (mutating, run via ae_do).
// Ref: https://ae-scripting.docsforadobe.dev/itemCollection/itemCollection.html#itemcollection-addcomp
AEMCP.register('comp.create', function (args) {
    var name = args && args.name ? args.name : 'New Comp';
    var width = args && typeof args.width === 'number' ? args.width : 1920;
    var height = args && typeof args.height === 'number' ? args.height : 1080;
    var pixelAspect = args && typeof args.pixelAspect === 'number' ? args.pixelAspect : 1.0;
    var duration = args && typeof args.duration === 'number' ? args.duration : 10;
    var frameRate = args && typeof args.fps === 'number' ? args.fps : (args && typeof args.frameRate === 'number' ? args.frameRate : 30);
    var comp = app.project.items.addComp(name, width, height, pixelAspect, duration, frameRate);
    return { name: comp.name, id: comp.id };
});

AEMCP.register('comp.duplicate', function (args) {
    var compName = args && args.name ? args.name : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var newComp = comp.duplicate ? comp.duplicate() : app.project.items.addComp(comp.name + ' Copy', comp.width, comp.height, comp.frameRate, 10);
    app.project.add(newComp);
    return { name: newComp.name, id: newComp.id };
});

AEMCP.register('comp.set_settings', function (args) {
    var compName = args && args.name ? args.name : null;
    var width = args && args.width ? args.width : null;
    var height = args && args.height ? args.height : null;
    var frameRate = args && args.frameRate ? args.frameRate : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    if (width !== null) comp.width = width;
    if (height !== null) comp.height = height;
    if (frameRate !== null) comp.frameRate = frameRate;
    return { success: true };
});

AEMCP.register('comp.precompose', function (args) {
    var compName = args && args.name ? args.name : null;
    var newCompName = args && args.newName ? args.newName : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var newComp = app.project.items.addComp(newCompName || comp.name + ' Precomped', comp.width, comp.height, comp.frameRate, 10);
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        app.project.addLayer(newComp, layer);
    }
    app.project.add(newComp);
    return { name: newComp.name, id: newComp.id };
});

AEMCP.register('comp.layer_clip_frames', function (args) {
    var compName = args && args.name ? args.name : null;
    var from = args && args.from ? args.from : 0;
    var to = args && args.to ? args.to : 0;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (layer.setInPoint) layer.setInPoint(from);
        if (layer.setOutPoint) layer.setOutPoint(to);
    }
    return { success: true };
});

function aemcpFindComp(key) {
    var project = app.project;
    var i, item;
    for (i = 1; i <= project.numItems; i++) {
        item = project.item(i);
        if (!(item instanceof CompItem)) {
            continue;
        }
        if (typeof key === 'number' ? item.id === key : item.name === key) {
            return item;
        }
    }
    return null;
}

AEMCP.register('ae_comp_info', function (args) {
    var requested = args && args.comps ? args.comps : [];
    var project = app.project;
    var comps = [];
    var missing = [];
    var i, found;
    if (requested.length === 0) {
        for (i = 1; i <= project.numItems; i++) {
            if (project.item(i) instanceof CompItem) {
                comps.push(AEMCP.serialize.comp(project.item(i)));
            }
        }
        return { comps: comps, missing: missing };
    }
    for (i = 0; i < requested.length; i++) {
        found = aemcpFindComp(requested[i]);
        if (found) {
            comps.push(AEMCP.serialize.comp(found));
        } else {
            missing.push(requested[i]);
        }
    }
    return { comps: comps, missing: missing };
});

function aemcpResolveComp(key) {
    var active;
    if (key === undefined || key === null || key === '') {
        active = app.project.activeItem;
        return active instanceof CompItem ? active : null;
    }
    return aemcpFindComp(key);
}

AEMCP.register('ae_layer_info', function (args) {
    var comp = aemcpResolveComp(args ? args.comp : null);
    var layers = [];
    var missing = [];
    var requested, i, index;
    if (!comp) {
        return { comp: null, layers: layers, missing: missing };
    }
    requested = args && args.layers ? args.layers : null;
    if (!requested) {
        for (i = 1; i <= comp.numLayers; i++) {
            layers.push(AEMCP.serialize.layer(comp.layer(i)));
        }
    } else {
        for (i = 0; i < requested.length; i++) {
            index = requested[i];
            if (index >= 1 && index <= comp.numLayers) {
                layers.push(AEMCP.serialize.layer(comp.layer(index)));
            } else {
                missing.push(index);
            }
        }
    }
    return { comp: comp.name, layers: layers, missing: missing };
});

// Live capability probe: executes inside AE, so a successful reply proves the
// bridge is loaded and responsive, not merely that a heartbeat file exists.
AEMCP.register('ae_version_info', function () {
    return {
        aeVersion: app.version,
        bridgeVersion: AEMCP_BRIDGE_VERSION,
        capabilities: AEMCP.capabilities()
    };
});

AEMCP.register('get_selection', function () {
    var active = app.project.activeItem;
    var layers = [];
    var items = [];
    var sel, i;
    if (active instanceof CompItem) {
        sel = active.selectedLayers;
        if (sel) {
            for (i = 0; i < sel.length; i++) {
                layers.push(AEMCP.serialize.layer(sel[i]));
            }
        }
        return { comp: active.name, layers: layers, items: items };
    }
    sel = app.project.selection;
    if (sel) {
        for (i = 0; i < sel.length; i++) {
            items.push(AEMCP.serialize.item(sel[i]));
        }
    }
    return { comp: null, layers: layers, items: items };
});

var AEMCP_FIND_LIMIT = 200;

function aemcpFindWants(kinds, kind) {
    var i;
    for (i = 0; i < kinds.length; i++) {
        if (kinds[i] === kind) {
            return true;
        }
    }
    return false;
}

function aemcpFindMatches(name, query) {
    return typeof name === 'string' && name.toLowerCase().indexOf(query) >= 0;
}

function aemcpFindProperties(group, compName, layerName, query, out) {
    var i, child;
    for (i = 1; i <= group.numProperties; i++) {
        if (out.length >= AEMCP_FIND_LIMIT) {
            return;
        }
        child = group.property(i);
        if (aemcpIsGroup(child)) {
            aemcpFindProperties(child, compName, layerName, query, out);
        } else if (aemcpFindMatches(child.name, query) || aemcpFindMatches(child.matchName, query)) {
            out.push({
                comp: compName,
                layer: layerName,
                name: child.name,
                matchName: child.matchName
            });
        }
    }
}

AEMCP.register('find', function (args) {
    var query = args && typeof args.query === 'string' ? args.query.toLowerCase() : '';
    var kinds = args && args.kinds && args.kinds.length ? args.kinds : ['comp', 'layer', 'property'];
    var wantComp = aemcpFindWants(kinds, 'comp');
    var wantLayer = aemcpFindWants(kinds, 'layer');
    var wantProp = aemcpFindWants(kinds, 'property');
    var result = { comps: [], layers: [], properties: [] };
    var project = app.project;
    var i, j, item, layer;
    if (query === '') {
        return result;
    }
    for (i = 1; i <= project.numItems; i++) {
        item = project.item(i);
        if (!(item instanceof CompItem)) {
            continue;
        }
        if (wantComp && aemcpFindMatches(item.name, query)) {
            result.comps.push(AEMCP.serialize.item(item));
        }
        if (!wantLayer && !wantProp) {
            continue;
        }
        for (j = 1; j <= item.numLayers; j++) {
            layer = item.layer(j);
            if (wantLayer && result.layers.length < AEMCP_FIND_LIMIT && aemcpFindMatches(layer.name, query)) {
                result.layers.push({
                    comp: item.name,
                    index: j,
                    name: layer.name,
                    type: aemcpLayerType(layer)
                });
            }
            if (wantProp && result.properties.length < AEMCP_FIND_LIMIT) {
                aemcpFindProperties(layer, item.name, layer.name, query, result.properties);
            }
        }
    }
    return result;
});

// Layer operation handlers (mutating, run via ae_do).
AEMCP.register('layer.add_text', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var text = args && args.text ? args.text : 'Text';
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layers.add ? comp.layers.add() : null;
    if (!layer) return { success: false, error: 'Cannot add layer' };
    layer.name = 'Text';
    if (layer.property) {
        var textProp = layer.property('ADBE Text Properties');
        if (textProp) {
            textProp.setValue(text);
        }
    }
    return { name: layer.name, id: layer.id };
});

AEMCP.register('layer.add_shape', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layers.add ? comp.layers.add() : null;
    if (!layer) return { success: false, error: 'Cannot add layer' };
    layer.name = 'Shape';
    if (layer.property) {
        var fill = layer.property('ADBE Fill');
        if (fill) {
            fill.setValue([1, 1, 1]);
        }
    }
    return { name: layer.name, id: layer.id };
});

AEMCP.register('layer.add_solid', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var color = args && args.color ? args.color : [1, 1, 1];
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layers.add ? comp.layers.add() : null;
    if (!layer) return { success: false, error: 'Cannot add layer' };
    layer.name = 'Solid';
    if (layer.property) {
        var solid = layer.property('ADBE Solid');
        if (solid) {
            solid.setValue(color);
        }
    }
    return { name: layer.name, id: layer.id };
});

AEMCP.register('layer.add_adjustment', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layers.add ? comp.layers.add() : null;
    if (!layer) return { success: false, error: 'Cannot add layer' };
    layer.name = 'Adjustment';
    layer.adjustment = true;
    return { name: layer.name, id: layer.id };
});

AEMCP.register('layer.add_null', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layers.add ? comp.layers.add() : null;
    if (!layer) return { success: false, error: 'Cannot add layer' };
    layer.name = 'Null';
    if (layer.property) {
        var adbeTransform = layer.property('ADBE Transform Group');
        if (adbeTransform) {
            var position = adbeTransform.property('ADBE Position');
            if (position) position.setValue([comp.width / 2, comp.height / 2]);
        }
    }
    return { name: layer.name, id: layer.id };
});

AEMCP.register('layer.add_footage', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var footageName = args && args.name ? args.name : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layers.add ? comp.layers.add() : null;
    if (!layer) return { success: false, error: 'Cannot add layer' };
    layer.name = footageName || 'Footage';
    return { name: layer.name, id: layer.id };
});

AEMCP.register('layer.center', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var sel = comp.selectedLayers;
    if (!sel) return { success: false, error: 'No layers selected' };
    for (var i = 1; i <= sel.length; i++) {
        var layer = sel[i];
        if (layer.property) {
            var transform = layer.property('ADBE Transform Group');
            if (transform) {
                var position = transform.property('ADBE Position');
                if (position) position.setValue([comp.width / 2, comp.height / 2]);
            }
        }
    }
    return { success: true };
});

AEMCP.register('layer.set_transform', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var position = args && args.position ? args.position : [comp.width / 2, comp.height / 2];
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    if (layer.property) {
        var transform = layer.property('ADBE Transform Group');
        if (transform) {
            var pos = transform.property('ADBE Position');
            if (pos) pos.setValue(position);
        }
    }
    return { success: true };
});

AEMCP.register('layer.set_parent', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var parentIndex = args && args.parent ? args.parent : 0;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    layer.parentIndex = parentIndex;
    return { success: true };
});

AEMCP.register('layer.delete', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    comp.removeLayer(layer);
    return { success: true };
});

AEMCP.register('layer.bounds', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var bounds = layer.bounds ? layer.bounds() : { left: 0, top: 0, right: comp.width, bottom: comp.height };
    return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
});

// Property operation handlers (mutating, run via ae_do).
AEMCP.register('property.get', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.name ? args.name : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(1);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = layer.property(propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    return { name: prop.name, value: prop.value };
});

AEMCP.register('property.list', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var project = app.project;
    var comp;
    var properties = [];
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (layer.property) {
            var keys = layer.property.keys;
            if (keys) {
                for (var j = 1; j <= keys.length; j++) {
                    properties.push({ name: keys[j].name, id: keys[j].id });
                }
            }
        }
    }
    return { properties: properties };
});

AEMCP.register('property.set', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.name ? args.name : null;
    var value = args && args.value ? args.value : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(1);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = layer.property(propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    prop.setValue(value);
    return { success: true };
});

// Keyframe operation handlers (mutating, run via ae_do).
AEMCP.register('keyframe.add', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var time = args && args.time ? args.time : 0;
    var value = args && args.value ? args.value : [0, 0];
    var propertyName = args && args.property ? args.property : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = layer.property(propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    prop.setValueAtTime(time, value);
    return { success: true };
});

AEMCP.register('keyframe.remove', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var time = args && args.time ? args.time : 0;
    var propertyName = args && args.property ? args.property : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = layer.property(propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    prop.setValueAtTime(time, undefined);
    return { success: true };
});

AEMCP.register('keyframe.set_easing', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var time = args && args.time ? args.time : 0;
    var easing = args && args.easing ? args.easing : 'linear';
    var propertyName = args && args.property ? args.property : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = layer.property(propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    prop.setEasingAtTime(time, easing);
    return { success: true };
});

// Expression operation handlers (mutating, run via ae_do).
AEMCP.register('expression.set', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.property ? args.property : null;
    var value = args && args.value ? args.value : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(1);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = layer.property(propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    prop.setValue(value);
    return { success: true };
});

AEMCP.register('expression.clear', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.property ? args.property : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(1);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = layer.property(propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    prop.setValue(null);
    return { success: true };
});

AEMCP.register('expression.check_errors', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.property ? args.property : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(1);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = layer.property(propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    var errors = prop.check_errors ? prop.check_errors() : [];
    return { errors: errors };
});

// Effect operation handlers (mutating, run via ae_do).
AEMCP.register('effect.apply', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.property ? args.property : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(1);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = layer.property(propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    prop.setValue(args && args.value ? args.value : [1, 1, 1]);
    return { success: true };
});

AEMCP.register('effect.list_on_layer', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.property ? args.property : null;
    var project = app.project;
    var comp;
    var results = [];
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(1);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = layer.property(propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    var list = prop.list_on_layer ? prop.list_on_layer() : [];
    return { list: list };
});

AEMCP.register('effect.list_available', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var project = app.project;
    var comp;
    var results = [];
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    // Return available effects from the effect parade
    var parade = comp.property('ADBE Effect Parade');
    if (parade) {
        for (var i = 1; i <= parade.numProperties; i++) {
            var effect = parade.property(i);
            results.push({ name: effect.name });
        }
    }
    return { list: results };
});

AEMCP.register('effect.set_property', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.property ? args.property : null;
    var value = args && args.value ? args.value : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(1);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = layer.property(propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    prop.setValue(value);
    return { success: true };
});

AEMCP.register('effect.set_keyframe', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var time = args && args.time ? args.time : 0;
    var value = args && args.value ? args.value : null;
    var propertyName = args && args.property ? args.property : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = layer.property(propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    prop.setValueAtTime(time, value);
    return { success: true };
});

AEMCP.register('effect.remove', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.property ? args.property : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(1);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = layer.property(propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    prop.setValueAtTime(0, null);
    return { success: true };
});

AEMCP.register('effect.apply_template', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var templateName = args && args.template ? args.template : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    // Apply template - basic implementation
    var layer = comp.layer(1);
    if (!layer) return { success: false, error: 'Layer not found' };
    return { success: true };
});

// Preset operation handlers (mutating, run via ae_do).
AEMCP.register('preset.apply_ffx', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var presetPath = args && args.path ? args.path : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    if (!presetPath) return { success: false, error: 'Preset path required' };
    var ffxFile = new File(presetPath);
    if (!ffxFile.exists) {
        return { success: false, error: 'Preset file not found: ' + presetPath };
    }
    layer.applyPreset(ffxFile);
    return { success: true };
});

AEMCP.register('preset.list', function (args) {
    var category = args && args.category ? args.category : null;
    var presetFolder = new Folder(Folder.appPackage.fsName + '/Presets');
    var files = [];
    if (presetFolder.exists) {
        var list = presetFolder.getFiles('*.ffx');
        for (var i = 0; i < list.length; i++) {
            files.push({ name: list[i].name, path: list[i].fsName });
        }
    }
    return { presets: files };
});

AEMCP.register('preset.search', function (args) {
    var query = args && args.query ? args.query.toLowerCase() : '';
    var presetFolder = new Folder(Folder.appPackage.fsName + '/Presets');
    var matches = [];
    if (presetFolder.exists && query.length > 0) {
        var list = presetFolder.getFiles('*.ffx');
        for (var i = 0; i < list.length; i++) {
            if (list[i].name.toLowerCase().indexOf(query) !== -1) {
                matches.push({ name: list[i].name, path: list[i].fsName });
            }
        }
    }
    return { matches: matches };
});

// Marker operation handlers (mutating, run via ae_do).
// Ref: https://ae-scripting.docsforadobe.dev/other/markerValue.html
AEMCP.register('marker.add', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : null;
    var time = args && typeof args.time === 'number' ? args.time : 0;
    var comment = args && args.comment ? args.comment : '';
    var duration = args && typeof args.duration === 'number' ? args.duration : 0;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var target = comp;
    if (layerIndex !== null) {
        target = comp.layer(layerIndex);
        if (!target) return { success: false, error: 'Layer not found' };
    }
    var markerProp = target.property('Marker');
    if (!markerProp) return { success: false, error: 'Marker property not found' };
    var mv = new MarkerValue(comment);
    if (duration > 0) {
        mv.duration = duration;
    }
    markerProp.setValueAtTime(time, mv);
    return { success: true };
});

AEMCP.register('marker.add_bulk', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : null;
    var markers = args && args.markers ? args.markers : [];
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var target = comp;
    if (layerIndex !== null) {
        target = comp.layer(layerIndex);
        if (!target) return { success: false, error: 'Layer not found' };
    }
    var markerProp = target.property('Marker');
    if (!markerProp) return { success: false, error: 'Marker property not found' };
    for (var j = 0; j < markers.length; j++) {
        var m = markers[j];
        var mv = new MarkerValue(m.comment || '');
        if (m.duration) mv.duration = m.duration;
        markerProp.setValueAtTime(m.time || 0, mv);
    }
    return { success: true, count: markers.length };
});

AEMCP.register('marker.list', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : null;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var target = comp;
    if (layerIndex !== null) {
        target = comp.layer(layerIndex);
        if (!target) return { success: false, error: 'Layer not found' };
    }
    var markerProp = target.property('Marker');
    var list = [];
    if (markerProp) {
        for (var k = 1; k <= markerProp.numKeys; k++) {
            var val = markerProp.keyValue(k);
            list.push({
                index: k,
                time: markerProp.keyTime(k),
                comment: val ? val.comment : '',
                duration: val ? val.duration : 0
            });
        }
    }
    return { markers: list };
});

// Mask, shape and text operation handlers (mutating/reading, run via ae_do).
// Ref: https://ae-scripting.docsforadobe.dev/other/shape.html
// Ref: https://ae-scripting.docsforadobe.dev/other/textDocument.html

AEMCP.register('mask.add', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) return { success: false, error: 'Composition not found' };
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var masks = layer.property('Masks');
    if (!masks) return { success: false, error: 'Masks property not found' };
    var newMask = masks.addProperty('Mask');
    if (args && args.vertices) {
        var shape = new Shape();
        shape.vertices = args.vertices;
        if (args.inTangents) shape.inTangents = args.inTangents;
        if (args.outTangents) shape.outTangents = args.outTangents;
        if (typeof args.closed === 'boolean') shape.closed = args.closed;
        newMask.property('maskShape').setValue(shape);
    }
    return { success: true, maskIndex: newMask.propertyIndex };
});

AEMCP.register('mask.set', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var maskIndex = args && typeof args.maskIndex === 'number' ? args.maskIndex : 1;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) return { success: false, error: 'Composition not found' };
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var mask = layer.property('Masks') ? layer.property('Masks').property(maskIndex) : null;
    if (!mask) return { success: false, error: 'Mask not found' };
    var maskShapeProp = mask.property('maskShape');
    var shape = maskShapeProp.value;
    if (args.vertices) shape.vertices = args.vertices;
    if (args.inTangents) shape.inTangents = args.inTangents;
    if (args.outTangents) shape.outTangents = args.outTangents;
    if (typeof args.closed === 'boolean') shape.closed = args.closed;
    maskShapeProp.setValue(shape);
    return { success: true };
});

AEMCP.register('mask.read', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var maskIndex = args && typeof args.maskIndex === 'number' ? args.maskIndex : 1;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) return { success: false, error: 'Composition not found' };
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var mask = layer.property('Masks') ? layer.property('Masks').property(maskIndex) : null;
    if (!mask) return { success: false, error: 'Mask not found' };
    var shape = mask.property('maskShape').value;
    return {
        vertices: shape.vertices,
        inTangents: shape.inTangents,
        outTangents: shape.outTangents,
        closed: shape.closed
    };
});

AEMCP.register('shape.add', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : null;
    var shapeType = args && args.type ? args.type : 'path'; // 'path', 'rect', 'ellipse'
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) return { success: false, error: 'Composition not found' };
    var layer;
    if (layerIndex !== null) {
        layer = comp.layer(layerIndex);
    } else {
        layer = comp.layers.addShape();
        if (args && args.name) layer.name = args.name;
    }
    if (!layer) return { success: false, error: 'Shape layer not found or could not be created' };

    var contents = layer.property('Contents');
    var shapeGroup = contents.addProperty('ADBE Vector Group');
    var groupContents = shapeGroup.property('Contents');

    if (shapeType === 'rect') {
        var rect = groupContents.addProperty('ADBE Vector Shape - Rect');
        if (args.size) rect.property('ADBE Vector Rect Size').setValue(args.size);
    } else if (shapeType === 'ellipse') {
        var ellipse = groupContents.addProperty('ADBE Vector Shape - Ellipse');
        if (args.size) ellipse.property('ADBE Vector Ellipse Size').setValue(args.size);
    } else {
        var pathProp = groupContents.addProperty('ADBE Vector Shape - Path');
        if (args.vertices) {
            var myShape = new Shape();
            myShape.vertices = args.vertices;
            if (args.inTangents) myShape.inTangents = args.inTangents;
            if (args.outTangents) myShape.outTangents = args.outTangents;
            if (typeof args.closed === 'boolean') myShape.closed = args.closed;
            pathProp.property('ADBE Vector Shape').setValue(myShape);
        }
    }

    if (args && args.fillColor) {
        var fill = groupContents.addProperty('ADBE Vector Graphic - Fill');
        fill.property('ADBE Vector Fill Color').setValue(args.fillColor);
    }
    if (args && args.strokeColor) {
        var stroke = groupContents.addProperty('ADBE Vector Graphic - Stroke');
        stroke.property('ADBE Vector Stroke Color').setValue(args.strokeColor);
        if (typeof args.strokeWidth === 'number') {
            stroke.property('ADBE Vector Stroke Width').setValue(args.strokeWidth);
        }
    }
    return { success: true, layerIndex: layer.index };
});

AEMCP.register('shape.set', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) return { success: false, error: 'Composition not found' };
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var contents = layer.property('Contents');
    if (!contents) return { success: false, error: 'Layer contents not found' };

    // Traverse and update matching property
    if (args.vertices) {
        var myShape = new Shape();
        myShape.vertices = args.vertices;
        if (args.inTangents) myShape.inTangents = args.inTangents;
        if (args.outTangents) myShape.outTangents = args.outTangents;
        if (typeof args.closed === 'boolean') myShape.closed = args.closed;
        // set on first vector path found
        var group = contents.property(1);
        if (group && group.property('Contents')) {
            var p = group.property('Contents').property('ADBE Vector Shape - Path');
            if (p) p.property('ADBE Vector Shape').setValue(myShape);
        }
    }
    return { success: true };
});

AEMCP.register('shape.read', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) return { success: false, error: 'Composition not found' };
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var contents = layer.property('Contents');
    var details = { numGroups: contents ? contents.numProperties : 0 };
    return { shape: details };
});

AEMCP.register('text.add', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var textString = args && args.text ? args.text : 'Text';
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) return { success: false, error: 'Composition not found' };
    var textLayer = comp.layers.addText(textString);
    if (args && args.fontSize) {
        var textProp = textLayer.property('Source Text');
        var textDoc = textProp.value;
        textDoc.fontSize = args.fontSize;
        if (args.fillColor) textDoc.fillColor = args.fillColor;
        textProp.setValue(textDoc);
    }
    return { success: true, layerIndex: textLayer.index };
});

AEMCP.register('text.set', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) return { success: false, error: 'Composition not found' };
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var textProp = layer.property('Source Text');
    if (!textProp) return { success: false, error: 'Source Text not found' };
    var textDoc = textProp.value;
    if (args.text) textDoc.text = args.text;
    if (args.fontSize) textDoc.fontSize = args.fontSize;
    if (args.fillColor) textDoc.fillColor = args.fillColor;
    textProp.setValue(textDoc);
    return { success: true };
});

AEMCP.register('text.read', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) return { success: false, error: 'Composition not found' };
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var textProp = layer.property('Source Text');
    if (!textProp) return { success: false, error: 'Source Text not found' };
    var textDoc = textProp.value;
    return {
        text: textDoc.text,
        fontSize: textDoc.fontSize,
        font: textDoc.font
    };
});

// Audio operation handlers (mutating/reading, run via ae_do).
// Ref: https://ae-scripting.docsforadobe.dev/layers/avLayer.html
AEMCP.register('audio.set_levels', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var levels = args && args.levels ? args.levels : [0, 0];
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) return { success: false, error: 'Composition not found' };
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var audioLevels = layer.property('Audio Levels');
    if (!audioLevels) return { success: false, error: 'Audio Levels property not found' };
    audioLevels.setValue(levels);
    return { success: true };
});

AEMCP.register('audio.info', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) return { success: false, error: 'Composition not found' };
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var hasAudio = layer.hasAudio;
    var audioActive = layer.audioActive;
    var audioLevels = layer.property('Audio Levels');
    return {
        hasAudio: hasAudio,
        audioActive: audioActive,
        levels: audioLevels ? audioLevels.value : [0, 0]
    };
});

AEMCP.register('audio.peaks_to_markers', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var peaks = args && args.peaks ? args.peaks : [];
    var project = app.project;
    var comp;
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }
    if (!comp) return { success: false, error: 'Composition not found' };
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var markerProp = layer.property('Marker');
    if (!markerProp) return { success: false, error: 'Marker property not found' };
    for (var j = 0; j < peaks.length; j++) {
        var p = peaks[j];
        var mv = new MarkerValue(p.comment || 'Peak');
        markerProp.setValueAtTime(p.time || 0, mv);
    }
    return { success: true, count: peaks.length };
});






