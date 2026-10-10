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


