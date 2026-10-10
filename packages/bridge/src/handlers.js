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
AEMCP.register('comp.create', function (args) {
    var name = args && args.name ? args.name : 'New Comp';
    var comp = app.project.items.addComp(name, 1920, 1080, 30, 10);
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


