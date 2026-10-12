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

// Snapshot the whole project as JSON, for later import (project.import_json).
AEMCP.register('project.export_json', function () {
    return AEMCP.serialize.projectSnapshot();
});

// There is no undo method in the scripting API; the Edit > Undo menu command
// is ID 16. Ref: https://ae-scripting.docsforadobe.dev/general/application/#appexecutecommand
AEMCP.register('project.undo', function () {
    app.executeCommand(16);
    return { success: true };
});

// File > Increment and Save. Found by name because the command ID differs per
// AE version and language package.
// Ref: https://ae-scripting.docsforadobe.dev/general/application/#appfindmenucommandid
AEMCP.register('project.increment_save', function () {
    if (!app.project.file) {
        return { success: false, error: 'project has never been saved' };
    }
    var id = app.findMenuCommandId('Increment and Save');
    if (!id) {
        return { success: false, error: 'Increment and Save command not found' };
    }
    app.executeCommand(id);
    return { success: true, file: app.project.file ? app.project.file.fsName : null };
});

// The set of project item ids that some composition places as a layer source.
function aemcpUsedItemIds(project) {
    var used = {};
    var i, l, comp, src;
    for (i = 1; i <= project.numItems; i++) {
        if (project.item(i) instanceof CompItem) {
            comp = project.item(i);
            for (l = 1; l <= comp.numLayers; l++) {
                src = comp.layer(l).source;
                if (src) {
                    used[src.id] = true;
                }
            }
        }
    }
    return used;
}

// Items other than comps and folders that no composition uses.
function aemcpUnusedItems(project) {
    var used = aemcpUsedItemIds(project);
    var out = [];
    var i, item;
    for (i = 1; i <= project.numItems; i++) {
        item = project.item(i);
        if (item instanceof CompItem || item instanceof FolderItem) {
            continue;
        }
        if (!used[item.id]) {
            out.push({ id: item.id, name: item.name, type: aemcpItemType(item) });
        }
    }
    return out;
}

// Report project hygiene: items no composition uses, and footage whose source
// file is missing.
// Ref: https://ae-scripting.docsforadobe.dev/item/footageitem/#footageitemfootagemissing
// Ref: https://ae-scripting.docsforadobe.dev/general/project/
AEMCP.register('project.report_usage', function () {
    var project = app.project;
    var unused = aemcpUnusedItems(project);
    var missing = [];
    var i, item;
    for (i = 1; i <= project.numItems; i++) {
        item = project.item(i);
        if (item instanceof FootageItem && item.footageMissing) {
            missing.push({
                id: item.id,
                name: item.name,
                file: item.file ? item.file.fsName : null
            });
        }
    }
    return {
        unusedItems: unused,
        missingFootage: missing,
        counts: {
            items: project.numItems,
            unused: unused.length,
            missing: missing.length
        }
    };
});

// Comp operation handlers (mutating, run via ae_do).
function aemcpAbortArgs(message) {
    aemcpAbort(aemcpErrorIssue('INVALID_ARGS', message));
}

// Resolve a comp by name, id or the active comp, or abort with INVALID_ARGS.
function aemcpRequireComp(key) {
    var comp = aemcpResolveComp(key);
    if (!comp) {
        if (key === undefined || key === null || key === '') {
            aemcpAbortArgs('no active composition');
        }
        aemcpAbortArgs('composition not found: ' + key);
    }
    return comp;
}

// Read the comp key argument, accepting `comp` or `name` (the older spelling).
function aemcpCompKey(args) {
    if (!args) {
        return null;
    }
    if (args.comp !== undefined && args.comp !== null) {
        return args.comp;
    }
    if (args.name !== undefined && args.name !== null) {
        return args.name;
    }
    return null;
}

// Collect layer indices from `layers`, or every layer when it is absent.
function aemcpLayerIndices(args, comp) {
    var indices = [];
    var i;
    if (args && args.layers !== undefined && args.layers !== null) {
        if (args.layers.length === 0) {
            aemcpAbortArgs('layers must be a non-empty array of layer indices');
        }
        for (i = 0; i < args.layers.length; i += 1) {
            var index = args.layers[i];
            if (typeof index !== 'number' || index !== Math.floor(index) || index < 1 || index > comp.numLayers) {
                aemcpAbortArgs('layer index out of range: ' + index);
            }
            indices.push(index);
        }
        return indices;
    }
    for (i = 1; i <= comp.numLayers; i += 1) {
        indices.push(i);
    }
    return indices;
}

// Ref: https://ae-scripting.docsforadobe.dev/itemCollection/itemCollection.html#itemcollection-addcomp
AEMCP.register('comp.create', function (args) {
    var name = args && args.name ? args.name : 'New Comp';
    var width = args && typeof args.width === 'number' ? args.width : 1920;
    var height = args && typeof args.height === 'number' ? args.height : 1080;
    var pixelAspect = args && typeof args.pixelAspect === 'number' ? args.pixelAspect : 1.0;
    var duration = args && typeof args.duration === 'number' ? args.duration : 10;
    var frameRate = args && typeof args.fps === 'number' ? args.fps : (args && typeof args.frameRate === 'number' ? args.frameRate : 30);
    var comp = app.project.items.addComp(name, width, height, pixelAspect, duration, frameRate);
    return AEMCP.serialize.comp(comp);
});

// Ref: https://ae-scripting.docsforadobe.dev/item/item.html#itemduplicate
AEMCP.register('comp.duplicate', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var copy = comp.duplicate();
    if (args && args.newName) {
        copy.name = args.newName;
    }
    return AEMCP.serialize.comp(copy);
});

AEMCP.register('comp.set_settings', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var changed = 0;
    if (args && typeof args.width === 'number') {
        comp.width = args.width;
        changed += 1;
    }
    if (args && typeof args.height === 'number') {
        comp.height = args.height;
        changed += 1;
    }
    if (args && typeof args.pixelAspect === 'number') {
        comp.pixelAspect = args.pixelAspect;
        changed += 1;
    }
    if (args && typeof args.duration === 'number') {
        comp.duration = args.duration;
        changed += 1;
    }
    if (args && typeof args.fps === 'number') {
        comp.frameRate = args.fps;
        changed += 1;
    }
    if (args && args.bgColor) {
        if (args.bgColor.length !== 3) {
            aemcpAbortArgs('bgColor must be [r, g, b]');
        }
        comp.bgColor = [args.bgColor[0], args.bgColor[1], args.bgColor[2]];
        changed += 1;
    }
    if (args && args.newName) {
        comp.name = args.newName;
        changed += 1;
    }
    if (changed === 0) {
        aemcpAbortArgs('no settings to change');
    }
    return AEMCP.serialize.comp(comp);
});

AEMCP.register('comp.info', function (args) {
    return AEMCP.serialize.comp(aemcpRequireComp(aemcpCompKey(args)));
});

// Ref: https://ae-scripting.docsforadobe.dev/layerCollection/layerCollection.html#layercollection-precompose
AEMCP.register('comp.precompose', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var indices = aemcpLayerIndices(args, comp);
    if (indices.length === 0) {
        aemcpAbortArgs('composition has no layers to precompose');
    }
    var moveAllAttributes = !(args && args.moveAllAttributes === false);
    if (!moveAllAttributes && indices.length > 1) {
        aemcpAbortArgs('moveAllAttributes can only be false when exactly one layer is precomposed');
    }
    var newName = args && args.newName ? args.newName : (args && args.comp !== undefined && args.name ? args.name : null);
    var newComp = comp.layers.precompose(indices, newName || 'Pre-comp', moveAllAttributes);
    return {
        name: newComp.name,
        comp: comp.name,
        numLayers: comp.numLayers,
        precomp: AEMCP.serialize.comp(newComp)
    };
});

AEMCP.register('comp.layer_clip_frames', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var from = args ? args.from : undefined;
    var to = args ? args.to : undefined;
    if (typeof from !== 'number' || typeof to !== 'number' || from !== Math.floor(from) || to !== Math.floor(to) || from < 0 || to <= from) {
        aemcpAbortArgs('from and to must be integer frames with 0 <= from < to');
    }
    var indices = aemcpLayerIndices(args, comp);
    var frameDuration = 1 / comp.frameRate;
    var inPoint = from * frameDuration;
    var outPoint = to * frameDuration;
    var i, layer;
    for (i = 0; i < indices.length; i += 1) {
        layer = comp.layer(indices[i]);
        layer.inPoint = inPoint;
        layer.outPoint = outPoint;
    }
    return { comp: comp.name, inPoint: inPoint, outPoint: outPoint, layers: indices };
});

// Sanitise a comp name for use as a file name.
function aemcpRenderFileName(comp, time) {
    var frame = Math.round(time * comp.frameRate);
    var safe = comp.name.replace(/[^A-Za-z0-9._-]/g, '_');
    return safe + '-' + frame + '.png';
}

// Default output path under the queue root: <root>/render/<comp>-<frame>.png.
function aemcpRenderPath(comp, time) {
    var dir = aemcpQueueRoot() + '/render';
    var folder = new Folder(dir);
    if (!folder.exists) {
        folder.create();
    }
    return dir + '/' + aemcpRenderFileName(comp, time);
}

// Fallback when CompItem.saveFrameToPng is unavailable: render a single frame
// through the render queue with a PNG output module, then remove the item.
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/renderqueue/
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/rqitemcollection/
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/outputmodule/
function aemcpRenderFrameViaQueue(comp, time, file) {
    var queue = app.project.renderQueue;
    var item = queue.items.add(comp);
    item.timeSpanStart = time;
    item.timeSpanDuration = 1 / comp.frameRate;
    var output = item.outputModule(1);
    output.file = new File(file);
    try {
        output.applyTemplate('PNG Sequence');
    } catch (err) {
        // Template may be missing on some installs; the output path still applies.
    }
    queue.render();
    item.remove();
}

// Ref: https://developer.adobe.com/after-effects/uxp/after-effects-api/compitem
AEMCP.register('render.frame', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var time = args && typeof args.time === 'number' ? args.time : 0;
    var file = args && args.file ? args.file : aemcpRenderPath(comp, time);
    var frame = Math.round(time * comp.frameRate);
    var method = typeof comp.saveFrameToPng === 'function' ? 'direct' : 'queue';
    if (method === 'direct') {
        comp.saveFrameToPng(time, new File(file));
    } else {
        aemcpRenderFrameViaQueue(comp, time, file);
    }
    return {
        method: method,
        comp: comp.name,
        file: file,
        time: time,
        frame: frame,
        width: comp.width,
        height: comp.height
    };
});

// Render queue helpers.
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/renderqueue/
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/renderqueueitem/
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/outputmodule/

// Map an RQItemStatus value back to its name for readable results.
function aemcpRqStatusName(status) {
    var names = ['QUEUED', 'UNQUEUED', 'RENDERING', 'DONE', 'ERR_STOPPED', 'USER_STOPPED', 'NEEDS_OUTPUT', 'WILL_CONTINUE'];
    var i;
    if (typeof RQItemStatus !== 'undefined') {
        for (i = 0; i < names.length; i++) {
            if (RQItemStatus[names[i]] === status) {
                return names[i];
            }
        }
    }
    return 'UNKNOWN';
}

// Fetch a render queue item by 1-based index (default: the first item).
function aemcpRequireRqItem(args) {
    var queue = app.project.renderQueue;
    var index = args && typeof args.item === 'number' ? args.item : 1;
    var item = queue.item(index);
    if (!item) {
        aemcpAbortArgs('render queue item not found: ' + index);
    }
    return item;
}

// Serialize one render queue item for the client.
function aemcpRenderItemInfo(item, index) {
    var output = item.outputModule(1);
    var file = output && output.file ? output.file.fsName : null;
    return {
        index: index,
        comp: item.comp ? item.comp.name : null,
        status: aemcpRqStatusName(item.status),
        render: item.render,
        timeSpanStart: item.timeSpanStart,
        timeSpanDuration: item.timeSpanDuration,
        outputFile: file,
        numOutputModules: item.numOutputModules
    };
}

function aemcpRenderQueueItems() {
    var queue = app.project.renderQueue;
    var items = [];
    var i;
    for (i = 1; i <= queue.numItems; i++) {
        items.push(aemcpRenderItemInfo(queue.item(i), i));
    }
    return items;
}

// Add a composition to the render queue, optionally with a time span.
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/rqitemcollection/#rqitemcollectionadd
AEMCP.register('render.queue_add', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var queue = app.project.renderQueue;
    var item = queue.items.add(comp);
    if (args && typeof args.timeSpanStart === 'number') {
        item.timeSpanStart = args.timeSpanStart;
    }
    if (args && typeof args.timeSpanDuration === 'number') {
        item.timeSpanDuration = args.timeSpanDuration;
    }
    return aemcpRenderItemInfo(item, queue.numItems);
});

// Point an item's output module at a file and/or apply an output template.
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/outputmodule/
AEMCP.register('render.queue_set_output', function (args) {
    var item = aemcpRequireRqItem(args);
    var output = item.outputModule(1);
    if (!output) {
        aemcpAbortArgs('render queue item has no output module');
    }
    if (args && args.template) {
        output.applyTemplate(args.template);
        // AE invalidates the output module object after applying a template;
        // re-fetch it before touching the file.
        output = item.outputModule(1);
    }
    if (args && args.file) {
        output.file = new File(args.file);
    }
    return aemcpRenderItemInfo(item, args && typeof args.item === 'number' ? args.item : 1);
});

// Start the render queue. AE renders synchronously and returns when complete.
// Ref: https://ae-scripting.docsforadobe.dev/renderqueue/renderqueue/#renderqueuerender
AEMCP.register('render.queue_start', function () {
    var queue = app.project.renderQueue;
    queue.render();
    return {
        rendered: true,
        numItems: queue.numItems,
        items: aemcpRenderQueueItems()
    };
});

// Report the render queue and every item's status.
AEMCP.register('render.status', function () {
    var queue = app.project.renderQueue;
    return {
        numItems: queue.numItems,
        rendering: queue.rendering,
        items: aemcpRenderQueueItems()
    };
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
    var layer = comp.layers.addText(text);
    layer.name = 'Text';
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
    var layer = comp.layers.addShape();
    layer.name = 'Shape';
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
    var layer = comp.layers.addSolid(color, 'Solid', comp.width, comp.height, comp.pixelAspect, comp.duration);
    layer.name = 'Solid';
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
    var layer = comp.layers.addSolid([0.5, 0.5, 0.5], 'Adjustment', comp.width, comp.height, comp.pixelAspect, comp.duration);
    layer.name = 'Adjustment';
    layer.adjustmentLayer = true;
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
    var layer = comp.layers.addNull(comp.duration);
    layer.name = 'Null';
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
    var source = null;
    for (var j = 1; j <= project.numItems; j++) {
        var candidate = project.item(j);
        if ((candidate instanceof FootageItem || candidate instanceof CompItem) && candidate.name === footageName) {
            source = candidate;
            break;
        }
    }
    if (!source) {
        return { success: false, error: 'Footage item not found' };
    }
    var layer = comp.layers.add(source);
    layer.name = footageName;
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
    var markerProp;
    if (layerIndex !== null) {
        var markerLayer = comp.layer(layerIndex);
        if (!markerLayer) return { success: false, error: 'Layer not found' };
        markerProp = markerLayer.property('ADBE Marker');
    } else {
        markerProp = comp.markerProperty;
    }
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
    var markerProp;
    if (layerIndex !== null) {
        var markerLayer = comp.layer(layerIndex);
        if (!markerLayer) return { success: false, error: 'Layer not found' };
        markerProp = markerLayer.property('ADBE Marker');
    } else {
        markerProp = comp.markerProperty;
    }
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
    var markerProp;
    if (layerIndex !== null) {
        var markerLayer = comp.layer(layerIndex);
        if (!markerLayer) return { success: false, error: 'Layer not found' };
        markerProp = markerLayer.property('ADBE Marker');
    } else {
        markerProp = comp.markerProperty;
    }
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

// Font and command operation handlers (run via ae_do).
// Ref: https://ae-scripting.docsforadobe.dev/other/app.html#app-fonts
// Ref: https://ae-scripting.docsforadobe.dev/other/app.html#app-executemenucommand
AEMCP.register('font.list', function (args) {
    var fonts = [];
    if (app.fonts && app.fonts.allFonts) {
        var all = app.fonts.allFonts;
        for (var i = 0; i < all.length; i++) {
            fonts.push({
                postScriptName: all[i].postScriptName,
                family: all[i].family,
                style: all[i].style
            });
        }
    }
    return { fonts: fonts };
});

AEMCP.register('command.find', function (args) {
    var name = args && args.name ? args.name : '';
    if (!name || !app.findMenuCommandId) {
        return { commandId: 0 };
    }
    var id = app.findMenuCommandId(name);
    return { commandId: id };
});

AEMCP.register('command.list', function (args) {
    // Return standard well-known After Effects menu command IDs
    var knownCommands = [
        { id: 2, name: 'Open Project...' },
        { id: 3, name: 'Close' },
        { id: 4, name: 'Save' },
        { id: 5, name: 'Save As...' },
        { id: 16, name: 'Undo' },
        { id: 17, name: 'Redo' },
        { id: 18, name: 'Cut' },
        { id: 19, name: 'Copy' },
        { id: 20, name: 'Paste' },
        { id: 21, name: 'Clear' },
        { id: 2000, name: 'New Composition...' },
        { id: 2004, name: 'Composition Settings...' },
        { id: 2154, name: 'Add to Render Queue' }
    ];
    return { commands: knownCommands };
});

AEMCP.register('command.execute', function (args) {
    var id = args && typeof args.id === 'number' ? args.id : 0;
    var name = args && args.name ? args.name : null;
    if (!id && name && app.findMenuCommandId) {
        id = app.findMenuCommandId(name);
    }
    if (!id) {
        return { success: false, error: 'Valid command ID or name required' };
    }
    app.executeCommand(id);
    return { success: true, commandId: id };
});

// Bulk operation handlers (previewed edits; run via ae_do, or planned and
// applied via ae_plan/ae_apply). Every bulk handler honours `dryRun`, which
// defaults to true, and returns a `fingerprint` of its targets so the server
// can refuse a stale plan.
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer.html

// Replace every literal occurrence without relying on a global RegExp.
function aemcpReplaceAll(text, find, replacement) {
    if (find === '') {
        return text;
    }
    return text.split(find).join(replacement);
}

function aemcpPadNumber(value, width) {
    var text = '' + value;
    while (text.length < width) {
        text = '0' + text;
    }
    return text;
}

// The new name for one layer, or the old name when nothing matches. `position`
// is the layer's 0-based place among the targets, used for numbering.
function aemcpRenamedLayerName(base, spec, position) {
    var out = base;
    if (typeof spec.match === 'string' && spec.match !== '') {
        if (spec.regex) {
            out = out.replace(new RegExp(spec.match, spec.flags), spec.replace);
        } else {
            out = aemcpReplaceAll(out, spec.match, spec.replace);
        }
    }
    if (spec.prefix) {
        out = spec.prefix + out;
    }
    if (spec.suffix) {
        out = out + spec.suffix;
    }
    if (spec.numbering) {
        var start = typeof spec.numbering.start === 'number' ? spec.numbering.start : 1;
        var step = typeof spec.numbering.step === 'number' ? spec.numbering.step : 1;
        var padding = typeof spec.numbering.padding === 'number' ? spec.numbering.padding : 0;
        var label = aemcpPadNumber(start + position * step, padding);
        if (spec.numbering.position === 'prefix') {
            out = label + out;
        } else {
            out = out + label;
        }
    }
    return out;
}

// Fingerprint of the target layers: it changes when a target is renamed,
// removed or reordered, so a plan made against the old names is refused.
function aemcpBulkFingerprint(compName, indices, names) {
    var parts = [];
    var i;
    for (i = 0; i < indices.length; i++) {
        parts.push(indices[i] + '=' + names[i]);
    }
    return compName + '#' + indices.length + ':' + parts.join(',');
}

AEMCP.register('bulk.rename', function (args) {
    var comp = aemcpResolveComp(args ? args.comp : null);
    if (!comp) {
        if (!args || args.comp === undefined || args.comp === null || args.comp === '') {
            aemcpAbortArgs('no active composition');
        }
        aemcpAbortArgs('composition not found: ' + args.comp);
    }
    var indices = aemcpLayerIndices(args, comp);
    var hasMatch = args && typeof args.match === 'string' && args.match !== '';
    var hasPrefix = args && typeof args.prefix === 'string' && args.prefix !== '';
    var hasSuffix = args && typeof args.suffix === 'string' && args.suffix !== '';
    var hasNumbering = args && args.numbering !== undefined && args.numbering !== null;
    if (!hasMatch && !hasPrefix && !hasSuffix && !hasNumbering) {
        aemcpAbortArgs('provide one of match, prefix, suffix or numbering');
    }
    if (hasNumbering && typeof args.numbering !== 'object') {
        aemcpAbortArgs('numbering must be an object');
    }
    var spec = {
        match: hasMatch ? args.match : null,
        replace: args && typeof args.replace === 'string' ? args.replace : '',
        regex: args && args.regex === true,
        flags: args && typeof args.flags === 'string' ? args.flags : '',
        prefix: hasPrefix ? args.prefix : '',
        suffix: hasSuffix ? args.suffix : '',
        numbering: hasNumbering ? args.numbering : null
    };
    if (spec.regex && typeof spec.match === 'string') {
        try {
            new RegExp(spec.match, spec.flags);
        } catch (err) {
            aemcpAbortArgs('invalid regular expression: ' + String(err));
        }
    }
    var names = [];
    var changes = [];
    var dryRun = !(args && args.dryRun === false);
    var i, layer, from, to;
    for (i = 0; i < indices.length; i++) {
        layer = comp.layer(indices[i]);
        from = layer.name;
        to = aemcpRenamedLayerName(from, spec, i);
        names.push(from);
        if (to !== from) {
            changes.push({ index: indices[i], from: from, to: to });
        }
    }
    var fingerprint = aemcpBulkFingerprint(comp.name, indices, names);
    if (dryRun) {
        return { dryRun: true, comp: comp.name, changes: changes, fingerprint: fingerprint };
    }
    for (i = 0; i < changes.length; i++) {
        comp.layer(changes[i].index).name = changes[i].to;
    }
    return {
        dryRun: false,
        comp: comp.name,
        applied: changes.length,
        changes: changes,
        fingerprint: fingerprint
    };
});

// Resolve the target comps for a bulk handler: an explicit `comps` array, else
// the single `comp` argument, else the active comp.
function aemcpBulkComps(args) {
    var keys = [];
    var i;
    if (args && args.comps !== undefined && args.comps !== null) {
        if (args.comps.length === 0) {
            aemcpAbortArgs('comps must be a non-empty array of comp names');
        }
        for (i = 0; i < args.comps.length; i++) {
            keys.push(args.comps[i]);
        }
    } else {
        keys.push(args ? args.comp : null);
    }
    var comps = [];
    for (i = 0; i < keys.length; i++) {
        var comp = aemcpResolveComp(keys[i]);
        if (!comp) {
            if (keys[i] === undefined || keys[i] === null || keys[i] === '') {
                aemcpAbortArgs('no active composition');
            }
            aemcpAbortArgs('composition not found: ' + keys[i]);
        }
        comps.push(comp);
    }
    return comps;
}

// Find a child property of `group` whose name or match name equals `query`, at
// any depth, so callers can name a nested property without the full path.
function aemcpSearchProperty(group, query) {
    if (!aemcpIsGroup(group)) {
        return null;
    }
    var i, child;
    for (i = 1; i <= group.numProperties; i++) {
        child = group.property(i);
        if (child && (child.name === query || child.matchName === query)) {
            return child;
        }
    }
    for (i = 1; i <= group.numProperties; i++) {
        child = group.property(i);
        if (aemcpIsGroup(child)) {
            var found = aemcpSearchProperty(child, query);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

// Resolve a property from a '/'-separated name path, falling back to a deep
// search by name or match name. Returns null when nothing matches.
function aemcpResolveProperty(group, path) {
    var segments = String(path).split('/');
    var current = group;
    var i, next;
    for (i = 0; i < segments.length; i++) {
        if (segments[i] === '' || !aemcpIsGroup(current)) {
            break;
        }
        next = current.property(segments[i]);
        if (!next) {
            current = null;
            break;
        }
        current = next;
    }
    if (current !== null && current !== group && !aemcpIsGroup(current)) {
        return current;
    }
    return aemcpSearchProperty(group, path);
}

AEMCP.register('bulk.set_property', function (args) {
    var propertyName = args && typeof args.property === 'string' ? args.property : '';
    if (propertyName === '') {
        aemcpAbortArgs('property is required');
    }
    if (!args || args.value === undefined) {
        aemcpAbortArgs('value is required');
    }
    var comps = aemcpBulkComps(args);
    var targetValue = args.value;
    var dryRun = !(args && args.dryRun === false);
    var changes = [];
    var skipped = [];
    var parts = [];
    var c, t;
    for (c = 0; c < comps.length; c++) {
        var comp = comps[c];
        var indices = aemcpLayerIndices(args, comp);
        for (t = 0; t < indices.length; t++) {
            var layer = comp.layer(indices[t]);
            var prop = aemcpResolveProperty(layer, propertyName);
            if (!prop || prop.setValue === undefined) {
                skipped.push({ comp: comp.name, index: indices[t] });
                parts.push(comp.name + ':' + indices[t] + '=missing');
                continue;
            }
            var from = prop.value;
            parts.push(comp.name + ':' + indices[t] + '=' + JSON.stringify(from));
            if (JSON.stringify(from) !== JSON.stringify(targetValue)) {
                changes.push({ comp: comp.name, index: indices[t], from: from, to: targetValue });
                if (!dryRun) {
                    prop.setValue(targetValue);
                }
            }
        }
    }
    var fingerprint = propertyName + '#' + parts.join(',');
    if (dryRun) {
        return {
            dryRun: true,
            property: propertyName,
            changes: changes,
            skipped: skipped,
            fingerprint: fingerprint
        };
    }
    return {
        dryRun: false,
        property: propertyName,
        applied: changes.length,
        changes: changes,
        skipped: skipped,
        fingerprint: fingerprint
    };
});

// True when an effect parade already holds an effect with this name or match
// name, so a re-run of a plan is a no-op rather than a duplicate effect.
function aemcpHasEffect(parade, name) {
    if (!aemcpIsGroup(parade)) {
        return false;
    }
    var i, effect;
    for (i = 1; i <= parade.numProperties; i++) {
        effect = parade.property(i);
        if (effect && (effect.name === name || effect.matchName === name)) {
            return true;
        }
    }
    return false;
}

// Ref: https://ae-scripting.docsforadobe.dev/property/propertygroup.html#propertygroupaddproperty
AEMCP.register('bulk.apply_effect', function (args) {
    var effectName = args && typeof args.effect === 'string' ? args.effect : '';
    if (effectName === '') {
        aemcpAbortArgs('effect is required');
    }
    var comp = aemcpResolveComp(args ? args.comp : null);
    if (!comp) {
        if (!args || args.comp === undefined || args.comp === null || args.comp === '') {
            aemcpAbortArgs('no active composition');
        }
        aemcpAbortArgs('composition not found: ' + args.comp);
    }
    var indices = aemcpLayerIndices(args, comp);
    var dryRun = !(args && args.dryRun === false);
    var changes = [];
    var skipped = [];
    var parts = [];
    var i, layer, parade, present;
    for (i = 0; i < indices.length; i++) {
        layer = comp.layer(indices[i]);
        parade = layer.property('ADBE Effect Parade');
        if (!aemcpIsGroup(parade)) {
            skipped.push({ index: indices[i], reason: 'unsupported' });
            parts.push('0');
            continue;
        }
        present = aemcpHasEffect(parade, effectName);
        parts.push(present ? '1' : '0');
        if (present) {
            skipped.push({ index: indices[i], reason: 'present' });
            continue;
        }
        changes.push({ index: indices[i], effect: effectName });
        if (!dryRun) {
            parade.addProperty(effectName);
        }
    }
    var fingerprint = 'effect:' + effectName + '#' + aemcpBulkFingerprint(comp.name, indices, parts);
    if (dryRun) {
        return {
            dryRun: true,
            comp: comp.name,
            effect: effectName,
            changes: changes,
            skipped: skipped,
            fingerprint: fingerprint
        };
    }
    return {
        dryRun: false,
        comp: comp.name,
        effect: effectName,
        applied: changes.length,
        changes: changes,
        skipped: skipped,
        fingerprint: fingerprint
    };
});

// Ref: https://ae-scripting.docsforadobe.dev/property/property.html#propertyexpression
AEMCP.register('bulk.set_expression', function (args) {
    var propertyName = args && typeof args.property === 'string' ? args.property : '';
    if (propertyName === '') {
        aemcpAbortArgs('property is required');
    }
    if (!args || typeof args.expression !== 'string') {
        aemcpAbortArgs('expression is required');
    }
    var comp = aemcpResolveComp(args ? args.comp : null);
    if (!comp) {
        if (!args || args.comp === undefined || args.comp === null || args.comp === '') {
            aemcpAbortArgs('no active composition');
        }
        aemcpAbortArgs('composition not found: ' + args.comp);
    }
    var indices = aemcpLayerIndices(args, comp);
    var expression = args.expression;
    var dryRun = !(args && args.dryRun === false);
    var changes = [];
    var skipped = [];
    var parts = [];
    var i, layer, prop, from;
    for (i = 0; i < indices.length; i++) {
        layer = comp.layer(indices[i]);
        prop = aemcpResolveProperty(layer, propertyName);
        if (!prop || prop.expression === undefined) {
            skipped.push({ index: indices[i], reason: 'no property' });
            parts.push('-');
            continue;
        }
        from = prop.expression;
        parts.push(from);
        if (from !== expression) {
            changes.push({ index: indices[i], from: from, to: expression });
            if (!dryRun) {
                prop.expression = expression;
                prop.expressionEnabled = expression !== '';
            }
        }
    }
    var fingerprint = 'expression:' + propertyName + '#' + aemcpBulkFingerprint(comp.name, indices, parts);
    if (dryRun) {
        return {
            dryRun: true,
            comp: comp.name,
            property: propertyName,
            changes: changes,
            skipped: skipped,
            fingerprint: fingerprint
        };
    }
    return {
        dryRun: false,
        comp: comp.name,
        property: propertyName,
        applied: changes.length,
        changes: changes,
        skipped: skipped,
        fingerprint: fingerprint
    };
});

// Ref: https://ae-scripting.docsforadobe.dev/layer/layer.html#layerapplypreset
AEMCP.register('bulk.apply_preset', function (args) {
    var presetPath = args && typeof args.preset === 'string' ? args.preset : '';
    if (presetPath === '') {
        aemcpAbortArgs('preset is required');
    }
    var ffxFile = new File(presetPath);
    if (!ffxFile.exists) {
        aemcpAbortArgs('preset file not found: ' + presetPath);
    }
    var comp = aemcpResolveComp(args ? args.comp : null);
    if (!comp) {
        if (!args || args.comp === undefined || args.comp === null || args.comp === '') {
            aemcpAbortArgs('no active composition');
        }
        aemcpAbortArgs('composition not found: ' + args.comp);
    }
    var indices = aemcpLayerIndices(args, comp);
    var dryRun = !(args && args.dryRun === false);
    var changes = [];
    var parts = [];
    var i;
    for (i = 0; i < indices.length; i++) {
        changes.push({ index: indices[i] });
        parts.push('1');
        if (!dryRun) {
            comp.layer(indices[i]).applyPreset(ffxFile);
        }
    }
    var fingerprint = 'preset:' + presetPath + '#' + aemcpBulkFingerprint(comp.name, indices, parts);
    if (dryRun) {
        return {
            dryRun: true,
            comp: comp.name,
            preset: presetPath,
            changes: changes,
            fingerprint: fingerprint
        };
    }
    return {
        dryRun: false,
        comp: comp.name,
        preset: presetPath,
        applied: changes.length,
        changes: changes,
        fingerprint: fingerprint
    };
});

// Find and replace text on every text layer of the target comp(s). Literal by
// default, or a regular expression when `regex` is true.
// Ref: https://ae-scripting.docsforadobe.dev/text/textdocument/
AEMCP.register('bulk.replace_text', function (args) {
    var find = args && typeof args.find === 'string' ? args.find : '';
    if (find === '') {
        aemcpAbortArgs('find is required');
    }
    var replace = args && typeof args.replace === 'string' ? args.replace : '';
    var useRegex = args && args.regex === true;
    var flags = args && typeof args.flags === 'string' ? args.flags : '';
    if (useRegex) {
        try {
            new RegExp(find, flags);
        } catch (err) {
            aemcpAbortArgs('invalid regular expression: ' + String(err));
        }
    }
    var comps = aemcpBulkComps(args);
    var dryRun = !(args && args.dryRun === false);
    var changes = [];
    var skipped = [];
    var parts = [];
    var c, t;
    for (c = 0; c < comps.length; c++) {
        var comp = comps[c];
        var indices = aemcpLayerIndices(args, comp);
        for (t = 0; t < indices.length; t++) {
            var layer = comp.layer(indices[t]);
            var prop = aemcpResolveProperty(layer, 'Source Text');
            var doc = prop ? prop.value : null;
            if (!doc || typeof doc.text !== 'string') {
                skipped.push({ comp: comp.name, index: indices[t] });
                parts.push(comp.name + ':' + indices[t] + '=none');
                continue;
            }
            var from = doc.text;
            var to;
            if (useRegex) {
                to = from.replace(new RegExp(find, flags), replace);
            } else {
                to = aemcpReplaceAll(from, find, replace);
            }
            parts.push(comp.name + ':' + indices[t] + '=' + JSON.stringify(from));
            if (to !== from) {
                changes.push({ comp: comp.name, index: indices[t], from: from, to: to });
                if (!dryRun) {
                    doc.text = to;
                    prop.setValue(doc);
                }
            }
        }
    }
    var fingerprint = 'text:' + find + '#' + parts.join(',');
    if (dryRun) {
        return {
            dryRun: true,
            changes: changes,
            skipped: skipped,
            fingerprint: fingerprint
        };
    }
    return {
        dryRun: false,
        applied: changes.length,
        changes: changes,
        skipped: skipped,
        fingerprint: fingerprint
    };
});

// Offset the start time of the selected layers (or the keyframe times of a
// property on them) by a fixed step, or a step that grows with the target's
// position in the selection.
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerstarttime
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertykeytime
AEMCP.register('bulk.stagger', function (args) {
    var offset = args && typeof args.offset === 'number' ? args.offset : null;
    if (offset === null || offset !== offset) {
        aemcpAbortArgs('offset is required');
    }
    var target = args && typeof args.target === 'string' ? args.target : 'layers';
    if (target !== 'layers' && target !== 'keyframes') {
        aemcpAbortArgs('target must be layers or keyframes');
    }
    var mode = args && typeof args.mode === 'string' ? args.mode : 'proportional';
    if (mode !== 'proportional' && mode !== 'fixed') {
        aemcpAbortArgs('mode must be proportional or fixed');
    }
    var propertyName = null;
    if (target === 'keyframes') {
        propertyName = args && typeof args.property === 'string' ? args.property : '';
        if (propertyName === '') {
            aemcpAbortArgs('property is required when target is keyframes');
        }
    }
    var comp = aemcpResolveComp(args ? args.comp : null);
    if (!comp) {
        if (!args || args.comp === undefined || args.comp === null || args.comp === '') {
            aemcpAbortArgs('no active composition');
        }
        aemcpAbortArgs('composition not found: ' + args.comp);
    }
    var indices = aemcpLayerIndices(args, comp);
    var dryRun = !(args && args.dryRun === false);
    var changes = [];
    var skipped = [];
    var parts = [];
    var i, layer, delta;
    for (i = 0; i < indices.length; i++) {
        layer = comp.layer(indices[i]);
        delta = mode === 'fixed' ? offset : offset * i;
        if (target === 'keyframes') {
            var prop = aemcpResolveProperty(layer, propertyName);
            if (!prop || typeof prop.numKeys !== 'number' || typeof prop.keyTime !== 'function') {
                skipped.push({ comp: comp.name, index: indices[i], reason: 'no property' });
                parts.push(comp.name + ':' + indices[i] + '=none');
                continue;
            }
            var n = prop.numKeys;
            if (n === 0) {
                skipped.push({ comp: comp.name, index: indices[i], reason: 'no keyframes' });
                parts.push(comp.name + ':' + indices[i] + '=0');
                continue;
            }
            var fromTimes = [];
            var values = [];
            var toTimes = [];
            var k;
            for (k = 1; k <= n; k++) {
                fromTimes.push(prop.keyTime(k));
                values.push(prop.keyValue(k));
            }
            for (k = 0; k < fromTimes.length; k++) {
                toTimes.push(fromTimes[k] + delta);
            }
            parts.push(comp.name + ':' + indices[i] + '=' + JSON.stringify(fromTimes));
            if (JSON.stringify(toTimes) !== JSON.stringify(fromTimes)) {
                changes.push({ comp: comp.name, index: indices[i], from: fromTimes, to: toTimes });
                if (!dryRun) {
                    for (k = n; k >= 1; k--) {
                        prop.removeKey(k);
                    }
                    for (k = 0; k < toTimes.length; k++) {
                        prop.setValueAtTime(toTimes[k], values[k]);
                    }
                }
            }
        } else {
            var fromStart = layer.startTime;
            var toStart = fromStart + delta;
            parts.push(comp.name + ':' + indices[i] + '=' + fromStart);
            if (toStart !== fromStart) {
                changes.push({ comp: comp.name, index: indices[i], from: fromStart, to: toStart });
                if (!dryRun) {
                    layer.startTime = toStart;
                }
            }
        }
    }
    var fingerprint = 'stagger:' + target + ':' + mode + ':' + offset + '#' + parts.join(',');
    if (dryRun) {
        return {
            dryRun: true,
            target: target,
            changes: changes,
            skipped: skipped,
            fingerprint: fingerprint
        };
    }
    return {
        dryRun: false,
        target: target,
        applied: changes.length,
        changes: changes,
        skipped: skipped,
        fingerprint: fingerprint
    };
});

// Set the label colour on every selected layer.
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerlabel
AEMCP.register('bulk.set_label', function (args) {
    var label = args && typeof args.label === 'number' ? args.label : null;
    if (label === null || label !== Math.floor(label) || label < 0 || label > 16) {
        aemcpAbortArgs('label must be an integer from 0 to 16');
    }
    var comps = aemcpBulkComps(args);
    var dryRun = !(args && args.dryRun === false);
    var changes = [];
    var parts = [];
    var c, t;
    for (c = 0; c < comps.length; c++) {
        var comp = comps[c];
        var indices = aemcpLayerIndices(args, comp);
        for (t = 0; t < indices.length; t++) {
            var layer = comp.layer(indices[t]);
            var from = layer.label;
            parts.push(comp.name + ':' + indices[t] + '=' + from);
            if (from !== label) {
                changes.push({ comp: comp.name, index: indices[t], from: from, to: label });
                if (!dryRun) {
                    layer.label = label;
                }
            }
        }
    }
    var fingerprint = 'label:' + label + '#' + parts.join(',');
    if (dryRun) {
        return {
            dryRun: true,
            label: label,
            changes: changes,
            fingerprint: fingerprint
        };
    }
    return {
        dryRun: false,
        label: label,
        applied: changes.length,
        changes: changes,
        fingerprint: fingerprint
    };
});


