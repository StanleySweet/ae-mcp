// Every AE match name the bridge uses, in one place. A misspelled match name
// passed to addProperty segfaults AE 26.5 instead of throwing
// (docs/findings/2026-10-16-shape-path-matchname-crash.md), so the bridge never
// writes an 'ADBE …' literal outside this table; match-names.test.ts enforces it
// and checks each value against the scripting guide's match-name pages.
// Ref: https://ae-scripting.docsforadobe.dev/matchnames/layer/avlayer/
// Ref: https://ae-scripting.docsforadobe.dev/matchnames/layer/shapelayer/
// Ref: https://ae-scripting.docsforadobe.dev/matchnames/layer/textlayer/
// Ref: https://ae-scripting.docsforadobe.dev/matchnames/effects/firstparty/
var AEMCP_MATCH = {
    TRANSFORM: 'ADBE Transform Group',
    ANCHOR_POINT: 'ADBE Anchor Point',
    POSITION: 'ADBE Position',
    SCALE: 'ADBE Scale',
    ROTATION: 'ADBE Rotate Z',
    OPACITY: 'ADBE Opacity',
    EFFECTS: 'ADBE Effect Parade',
    MASKS: 'ADBE Mask Parade',
    // Not in the scripting guide; read from live fr_FR AE 26.5 (#177).
    MASK_ATOM: 'ADBE Mask Atom',
    MASK_SHAPE: 'ADBE Mask Shape',
    MARKER: 'ADBE Marker',
    TEXT_PROPERTIES: 'ADBE Text Properties',
    TEXT_DOCUMENT: 'ADBE Text Document',
    SLIDER_CONTROL: 'ADBE Slider Control',
    SHAPE_ROOT: 'ADBE Root Vectors Group',
    SHAPE_GROUP: 'ADBE Vector Group',
    SHAPE_GROUP_CONTENTS: 'ADBE Vectors Group',
    SHAPE_PATH: 'ADBE Vector Shape - Group',
    SHAPE_PATH_VALUE: 'ADBE Vector Shape',
    SHAPE_RECT: 'ADBE Vector Shape - Rect',
    SHAPE_RECT_SIZE: 'ADBE Vector Rect Size',
    SHAPE_ELLIPSE: 'ADBE Vector Shape - Ellipse',
    SHAPE_ELLIPSE_SIZE: 'ADBE Vector Ellipse Size',
    SHAPE_FILL: 'ADBE Vector Graphic - Fill',
    SHAPE_FILL_COLOR: 'ADBE Vector Fill Color',
    SHAPE_STROKE: 'ADBE Vector Graphic - Stroke',
    SHAPE_STROKE_COLOR: 'ADBE Vector Stroke Color',
    SHAPE_STROKE_WIDTH: 'ADBE Vector Stroke Width'
};

// The only way the bridge adds a property: ask AE (canAddProperty) whether the
// match name is valid in this group first, and abort with INVALID_ARGS if not,
// so a bad name never reaches addProperty.
// Ref: https://ae-scripting.docsforadobe.dev/property/propertygroup/#propertygroupcanaddproperty
function aemcpAddProperty(group, matchName) {
    if (!group.canAddProperty(matchName)) {
        aemcpAbort(aemcpErrorIssue('INVALID_ARGS', 'cannot add ' + matchName + ' to ' + group.matchName));
    }
    return group.addProperty(matchName);
}

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

// Save the open project, or Save As when `path` is given (no dialog either way).
// A never-saved project has nowhere to go without a path: save() would prompt.
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectsave
AEMCP.register('project.save', function (args) {
    var path = args && args.path ? args.path : null;
    if (path) {
        app.project.save(new File(path));
    } else {
        if (!app.project.file) {
            aemcpAbortArgs('project has never been saved: pass path');
        }
        app.project.save();
    }
    return { file: app.project.file ? app.project.file.fsName : null };
});

// Open a project file. Project.dirty is "officially undocumented" in the guide
// (AE 17.5+), so an unreadable flag counts as dirty: refuse unless force.
// Forcing closes the current project without saving first so AE never shows a
// save prompt; ae_do's destructive guard already increment-saved it.
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectdirty
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectclose
// Ref: https://ae-scripting.docsforadobe.dev/general/application/#appopen
AEMCP.register('project.open', function (args) {
    var path = args && args.path ? args.path : null;
    if (!path) {
        aemcpAbortArgs('path is required');
    }
    var file = new File(path);
    if (!file.exists) {
        aemcpAbortArgs('file not found: ' + path);
    }
    var dirty = app.project.dirty;
    if (!(args && args.force === true) && dirty !== false) {
        aemcpAbortArgs(typeof dirty === 'boolean'
            ? 'the open project has unsaved changes: save it or pass force: true'
            : 'cannot tell whether the open project has unsaved changes (Project.dirty is unavailable): pass force: true');
    }
    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    var opened = app.open(file);
    if (!opened) {
        aemcpAbortArgs('could not open: ' + path);
    }
    return { file: opened.file ? opened.file.fsName : path, numItems: opened.numItems };
});

// Rebuild comps and layers from an aemcp-project/v1 snapshot (project.export_json).
// Layers are created bottom-up so indices match. Footage, precomp and other
// layers are reported in `skipped`; folders and footage items are not recreated.
// Ref: https://ae-scripting.docsforadobe.dev/general/itemcollection/#itemcollectionaddcomp
// Ref: https://ae-scripting.docsforadobe.dev/layer/layercollection/
var AEMCP_IMPORT_TRANSFORMS = [
    AEMCP_MATCH.ANCHOR_POINT,
    AEMCP_MATCH.POSITION,
    AEMCP_MATCH.SCALE,
    AEMCP_MATCH.ROTATION,
    AEMCP_MATCH.OPACITY
];

function aemcpImportLayer(comp, info) {
    var layer = null;
    var hasSource = info.sourceId !== null && info.sourceId !== undefined;
    if (info.type === 'TextLayer') {
        layer = comp.layers.addText(info.text && info.text.text ? info.text.text : '');
    } else if (info.type === 'ShapeLayer') {
        layer = comp.layers.addShape();
    } else if (info.type === 'AVLayer' && info.nullLayer) {
        layer = comp.layers.addNull(comp.duration);
    } else if (info.type === 'AVLayer' && info.solidColor) {
        layer = comp.layers.addSolid(info.solidColor, info.sourceName || info.name,
            info.width || comp.width, info.height || comp.height, comp.pixelAspect, comp.duration);
    } else if (info.type === 'AVLayer' && !hasSource) {
        layer = comp.layers.addSolid([1, 1, 1], info.name, comp.width, comp.height, comp.pixelAspect, comp.duration);
    }
    if (!layer) {
        return null;
    }
    layer.name = info.name;
    var transform = layer.property(AEMCP_MATCH.TRANSFORM);
    var values = info.transform && info.transform.properties ? info.transform.properties : [];
    var i, j;
    for (i = 0; transform && i < values.length; i++) {
        for (j = 0; j < AEMCP_IMPORT_TRANSFORMS.length; j++) {
            if (values[i].matchName === AEMCP_IMPORT_TRANSFORMS[j] && values[i].value !== undefined && values[i].value !== null) {
                var prop = transform.property(values[i].matchName);
                if (prop) {
                    prop.setValue(values[i].value);
                }
            }
        }
    }
    return layer;
}

AEMCP.register('project.import_json', function (args) {
    var snapshot = args ? args.snapshot : null;
    if (!snapshot || snapshot.format !== 'aemcp-project/v1' || !snapshot.items || typeof snapshot.items.length !== 'number') {
        aemcpAbortArgs('snapshot must be an aemcp-project/v1 object');
    }
    var comps = [];
    var skipped = [];
    var i, j;
    for (i = 0; i < snapshot.items.length; i++) {
        var item = snapshot.items[i];
        if (item.type !== 'Composition') {
            continue;
        }
        var comp = app.project.items.addComp(item.name, item.width, item.height,
            item.pixelAspect || 1, item.duration, item.frameRate);
        var layers = item.layers || [];
        var made = 0;
        for (j = layers.length - 1; j >= 0; j--) {
            if (aemcpImportLayer(comp, layers[j])) {
                made++;
            } else {
                skipped.push({ comp: item.name, layer: layers[j].name, type: layers[j].type });
            }
        }
        comps.push({ name: comp.name, layers: made });
    }
    return { comps: comps, skipped: skipped };
});

// There is no undo method in the scripting API; the Edit > Undo menu command
// is ID 16. Ref: https://ae-scripting.docsforadobe.dev/general/application/#appexecutecommand
AEMCP.register('project.undo', function () {
    app.executeCommand(16);
    return { success: true };
});

// File > Increment and Save, done natively so it does not depend on the
// localized menu name (app.findMenuCommandId only takes a localized string).
// app.project.save(file) saves to a new file without prompting.
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectsave
AEMCP.register('project.increment_save', function () {
    if (!app.project.file) {
        aemcpAbort(aemcpErrorIssue('UNSAVED_PROJECT', 'project has never been saved'));
    }
    app.project.save(new File(aemcpNextIncrementPath(app.project.file.fsName)));
    return { success: true, file: app.project.file ? app.project.file.fsName : null };
});

// MyProject_v007.aep -> MyProject_v008.aep; MyProject.aep -> MyProject_v001.aep.
function aemcpNextIncrementPath(path) {
    var slash = path.lastIndexOf('/');
    var dir = slash >= 0 ? path.substring(0, slash + 1) : '';
    var name = slash >= 0 ? path.substring(slash + 1) : path;
    var dot = name.lastIndexOf('.');
    var base = dot >= 0 ? name.substring(0, dot) : name;
    var ext = dot >= 0 ? name.substring(dot) : '';
    var match = /^(.*)_v(\d+)$/.exec(base);
    var next;
    if (match) {
        var digits = String(Number(match[2]) + 1);
        while (digits.length < match[2].length) {
            digits = '0' + digits;
        }
        next = match[1] + '_v' + digits;
    } else {
        next = base + '_v001';
    }
    return dir + next + ext;
}

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
    // Always under the render folder: this op is read-only (#178).
    var file = aemcpRenderPath(comp, time);
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

// Walk a property tree and collect every property carrying an enabled
// expression, keyed by its slash-joined property path.
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyexpressionenabled
function aemcpCollectExpressions(group, prefix, out) {
    var i, child, path;
    for (i = 1; i <= group.numProperties; i++) {
        child = group.property(i);
        if (!child) {
            continue;
        }
        path = prefix ? prefix + '/' + child.name : child.name;
        if (aemcpIsGroup(child)) {
            aemcpCollectExpressions(child, path, out);
        } else if (child.expressionEnabled && child.expression) {
            out.push({ path: path, matchName: child.matchName, expression: child.expression });
        }
    }
    return out;
}

// Enumerate a layer/group's properties (name + match name). Groups are expanded
// only while `depth` allows (depth 1 = top level, groups listed with numProperties).
// Properties with enabled === false and empty groups are skipped.
// Ref: https://ae-scripting.docsforadobe.dev/property/propertybase/#propertybaseenabled
// Ref: https://ae-scripting.docsforadobe.dev/property/propertygroup/#propertyproperty
function aemcpListProperties(group, depth) {
    var out = [];
    for (var i = 1; i <= group.numProperties; i++) {
        var child = group.property(i);
        if (!child || child.enabled === false) {
            continue;
        }
        var isGroup = aemcpIsGroup(child);
        if (isGroup && child.numProperties === 0) {
            continue;
        }
        var entry = { name: child.name, matchName: child.matchName };
        if (isGroup) {
            if (depth > 1) {
                entry.properties = aemcpListProperties(child, depth - 1);
            } else {
                entry.numProperties = child.numProperties;
            }
        }
        out.push(entry);
    }
    return out;
}

AEMCP.register('ae_expression_report', function (args) {
    var comp = aemcpResolveComp(args ? args.comp : null);
    var layers = [];
    var missing = [];
    var requested, i, index, layer;
    if (!comp) {
        return { comp: null, layers: layers, missing: missing };
    }
    requested = args && args.layers ? args.layers : null;
    if (!requested) {
        for (i = 1; i <= comp.numLayers; i++) {
            layer = comp.layer(i);
            layers.push({
                index: layer.index,
                name: layer.name,
                expressions: aemcpCollectExpressions(layer, '', [])
            });
        }
    } else {
        for (i = 0; i < requested.length; i++) {
            index = requested[i];
            if (index >= 1 && index <= comp.numLayers) {
                layer = comp.layer(index);
                layers.push({
                    index: layer.index,
                    name: layer.name,
                    expressions: aemcpCollectExpressions(layer, '', [])
                });
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
    var comp = aemcpRequireComp(compName);
    var layer = comp.layers.addText(text);
    layer.name = 'Text';
    return { name: layer.name, id: layer.id };
});

AEMCP.register('layer.add_shape', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layers.addShape();
    layer.name = 'Shape';
    return { name: layer.name, id: layer.id };
});

// Ref: https://ae-scripting.docsforadobe.dev/layer/layercollection/#layercollectionaddcamera
AEMCP.register('layer.add_camera', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var name = args && args.name ? args.name : 'Camera';
    var center = args && args.centerPoint ? args.centerPoint : [comp.width / 2, comp.height / 2];
    var layer = comp.layers.addCamera(name, center);
    return { index: layer.index, name: layer.name, id: layer.id };
});

// Ref: https://ae-scripting.docsforadobe.dev/layer/layercollection/#layercollectionaddlight
// Ref: https://ae-scripting.docsforadobe.dev/layer/lightlayer/#lightlayerlighttype
AEMCP.register('layer.add_light', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var types = { parallel: LightType.PARALLEL, spot: LightType.SPOT, point: LightType.POINT, ambient: LightType.AMBIENT };
    var lightType = args && args.lightType ? args.lightType : null;
    if (lightType !== null && !types.hasOwnProperty(lightType)) {
        aemcpAbortArgs('unknown lightType: ' + lightType + ' (parallel, spot, point, ambient)');
    }
    var name = args && args.name ? args.name : 'Light';
    var center = args && args.centerPoint ? args.centerPoint : [comp.width / 2, comp.height / 2];
    var layer = comp.layers.addLight(name, center);
    if (lightType !== null) {
        layer.lightType = types[lightType];
    }
    return { index: layer.index, name: layer.name, id: layer.id, lightType: lightType };
});

// Ref: https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayerthreedlayer
AEMCP.register('layer.set_3d', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var layer = comp.layer(args ? args.index : 0);
    if (!layer) {
        aemcpAbortArgs('layer not found: ' + (args ? args.index : undefined));
    }
    if (!(layer instanceof AVLayer)) {
        aemcpAbortArgs('layer ' + layer.index + ' cannot be 3D (camera and light layers are not AV layers)');
    }
    layer.threeDLayer = !!(args && args.enabled);
    return { index: layer.index, threeDLayer: layer.threeDLayer };
});

AEMCP.register('layer.add_solid', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var color = args && args.color ? args.color : [1, 1, 1];
    var comp = aemcpRequireComp(compName);
    var layer = comp.layers.addSolid(color, 'Solid', comp.width, comp.height, comp.pixelAspect, comp.duration);
    layer.name = 'Solid';
    return { name: layer.name, id: layer.id };
});

AEMCP.register('layer.add_adjustment', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layers.addSolid([0.5, 0.5, 0.5], 'Adjustment', comp.width, comp.height, comp.pixelAspect, comp.duration);
    layer.name = 'Adjustment';
    layer.adjustmentLayer = true;
    return { name: layer.name, id: layer.id };
});

AEMCP.register('layer.add_null', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layers.addNull(comp.duration);
    layer.name = 'Null';
    return { name: layer.name, id: layer.id };
});

AEMCP.register('layer.add_footage', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var footageName = args && args.name ? args.name : null;
    var project = app.project;
    var comp = aemcpRequireComp(compName);
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
    var comp = aemcpRequireComp(compName);
    var sel = comp.selectedLayers;
    if (!sel) return { success: false, error: 'No layers selected' };
    for (var i = 1; i <= sel.length; i++) {
        var layer = sel[i];
        if (layer.property) {
            var transform = layer.property(AEMCP_MATCH.TRANSFORM);
            if (transform) {
                var position = transform.property(AEMCP_MATCH.POSITION);
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
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    if (layer.property) {
        var transform = layer.property(AEMCP_MATCH.TRANSFORM);
        if (transform) {
            var pos = transform.property(AEMCP_MATCH.POSITION);
            if (pos) pos.setValue(position);
        }
    }
    return { success: true };
});

AEMCP.register('layer.set_parent', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var parentIndex = args && args.parent ? args.parent : 0;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    layer.parentIndex = parentIndex;
    return { success: true };
});

AEMCP.register('layer.delete', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    // Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerremove
    layer.remove();
    return { success: true };
});

AEMCP.register('layer.bounds', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    if (typeof layer.sourceRectAtTime !== 'function') {
        return { success: false, error: 'Layer does not report bounds: ' + layer.name };
    }
    var time = args && typeof args.time === 'number' ? args.time : (layer.time || 0);
    // Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#sourcerectattime
    // The rect is in layer space; map both corners through sourcePointToComp to
    // report a comp-space box (scale/rotation/parenting are folded in by AE).
    // Ref: https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayersourcepointtocomp
    var rect = layer.sourceRectAtTime(time, true);
    var topLeft = layer.sourcePointToComp([rect.left, rect.top]);
    var bottomRight = layer.sourcePointToComp([rect.left + rect.width, rect.top + rect.height]);
    return {
        left: topLeft[0],
        top: topLeft[1],
        right: bottomRight[0],
        bottom: bottomRight[1],
        width: rect.width,
        height: rect.height
    };
});

// A property carrying an expression ignores direct value or keyframe edits: the
// expression is the real driver, so surface it and point at editing the control.
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyexpressionenabled
function aemcpWithExpressionWarning(prop, result) {
    if (prop && prop.expressionEnabled && prop.expression) {
        result.warning = 'property "' + prop.name + '" is driven by an expression (' +
            prop.expression + '); edit the driving control instead of setting its value';
    }
    return result;
}

// Property operation handlers (mutating, run via ae_do).
AEMCP.register('property.get', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.name ? args.name : null;
    var layerIndex = args && args.index ? args.index : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = aemcpResolveProperty(layer, propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    return { name: prop.name, value: prop.value };
});

AEMCP.register('property.list', function (args) {
    var comp = aemcpResolveComp(args ? args.comp : null);
    if (!comp) {
        return { success: false, error: 'Composition not found' };
    }
    var depth = args && args.depth !== undefined && args.depth !== null ? args.depth : 1;
    if (typeof depth !== 'number' || depth !== Math.floor(depth) || depth < 1) {
        aemcpAbortArgs('depth must be an integer of at least 1');
    }
    var indices = [];
    var i;
    if (args && args.index !== undefined && args.index !== null) {
        var index = args.index;
        if (typeof index !== 'number' || index !== Math.floor(index) || index < 1 || index > comp.numLayers) {
            aemcpAbortArgs('layer not found: ' + index);
        }
        indices.push(index);
    } else {
        for (i = 1; i <= comp.numLayers; i++) {
            indices.push(i);
        }
    }
    var layers = [];
    for (i = 0; i < indices.length; i++) {
        var layer = comp.layer(indices[i]);
        layers.push({ index: indices[i], name: layer.name, properties: aemcpListProperties(layer, depth) });
    }
    return { layers: layers };
});

AEMCP.register('property.set', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.name ? args.name : null;
    // 0, [], "" and false are valid values, so test presence, not truthiness.
    var value = args && args.value !== undefined ? args.value : null;
    var layerIndex = args && args.index ? args.index : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = aemcpResolveProperty(layer, propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    prop.setValue(value);
    return aemcpWithExpressionWarning(prop, { success: true });
});

// Read every key of a property: time, value, interpolation types and temporal eases.
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertykeyininterpolationtype
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertykeyintemporalease
function aemcpReadKeys(prop) {
    var keys = [];
    var i;
    for (i = 1; i <= prop.numKeys; i++) {
        keys.push({
            time: prop.keyTime(i),
            value: prop.keyValue(i),
            inType: prop.keyInInterpolationType(i),
            outType: prop.keyOutInterpolationType(i),
            inEase: prop.keyInTemporalEase(i),
            outEase: prop.keyOutTemporalEase(i)
        });
    }
    return keys;
}

// Write keys (as read by aemcpReadKeys) onto a property, restoring interpolation and eases.
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysetvalueattime
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysetinterpolationtypeatkey
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysettemporaleaseatkey
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertynearestkeyindex
function aemcpWriteKeys(prop, keys) {
    var i, key, at;
    for (i = 0; i < keys.length; i++) {
        key = keys[i];
        prop.setValueAtTime(key.time, key.value);
        at = prop.nearestKeyIndex(key.time);
        prop.setInterpolationTypeAtKey(at, key.inType, key.outType);
        try {
            prop.setTemporalEaseAtKey(at, key.inEase, key.outEase);
        } catch (e) {
            // Hold keys reject temporal eases; the interpolation type alone is enough.
        }
    }
}

function aemcpKeyTimes(keys) {
    var times = [];
    var i;
    for (i = 0; i < keys.length; i++) {
        times.push(keys[i].time);
    }
    return times;
}

// Resolve a property that has at least one key, or abort with INVALID_ARGS.
function aemcpRequireKeyedProperty(layer, path) {
    var prop = typeof path === 'string' && path !== '' ? aemcpResolveProperty(layer, path) : null;
    if (!prop || typeof prop.numKeys !== 'number') {
        aemcpAbortArgs('property not found: ' + path);
    }
    if (prop.numKeys === 0) {
        aemcpAbortArgs('property has no keyframes: ' + path);
    }
    return prop;
}

function aemcpNumberArg(args, name) {
    var v = args ? args[name] : undefined;
    if (typeof v !== 'number' || v !== v) {
        aemcpAbortArgs(name + ' must be a number');
    }
    return v;
}

// Move every key of a property in place (read all, remove all, write back),
// mapping each time through transform(time, firstTime, lastTime).
function aemcpRetimeKeys(args, transform) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var layer = comp.layer(args && args.index ? args.index : 1);
    if (!layer) {
        aemcpAbortArgs('layer not found: ' + (args && args.index));
    }
    var prop = aemcpRequireKeyedProperty(layer, args && args.property);
    var keys = aemcpReadKeys(prop);
    var first = keys[0].time;
    var last = keys[keys.length - 1].time;
    var i;
    for (i = 0; i < keys.length; i++) {
        keys[i].time = transform(keys[i].time, first, last);
    }
    for (i = prop.numKeys; i >= 1; i--) {
        prop.removeKey(i);
    }
    aemcpWriteKeys(prop, keys);
    return { success: true, keys: keys.length, times: aemcpKeyTimes(keys) };
}

// Copy every key (time, value, interpolation, temporal ease) onto another property.
AEMCP.register('keyframe.copy', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var from = args && args.from;
    var to = args && args.to;
    if (!from || !to) {
        aemcpAbortArgs('from and to are required');
    }
    var offset = args.offset === undefined ? 0 : aemcpNumberArg(args, 'offset');
    var srcLayer = comp.layer(from.index || 1);
    var dstLayer = comp.layer(to.index || 1);
    if (!srcLayer || !dstLayer) {
        aemcpAbortArgs('layer not found');
    }
    var src = aemcpRequireKeyedProperty(srcLayer, from.property);
    var dst = typeof to.property === 'string' && to.property !== '' ? aemcpResolveProperty(dstLayer, to.property) : null;
    if (!dst || typeof dst.setValueAtTime !== 'function') {
        aemcpAbortArgs('property not found: ' + to.property);
    }
    var keys = aemcpReadKeys(src);
    var i;
    for (i = 0; i < keys.length; i++) {
        keys[i].time += offset;
    }
    aemcpWriteKeys(dst, keys);
    return { success: true, keys: keys.length, times: aemcpKeyTimes(keys) };
});

AEMCP.register('keyframe.offset', function (args) {
    var seconds = aemcpNumberArg(args, 'seconds');
    return aemcpRetimeKeys(args, function (t) { return t + seconds; });
});

// Mirror key times within [first, last].
AEMCP.register('keyframe.reverse', function (args) {
    return aemcpRetimeKeys(args, function (t, first, last) { return first + last - t; });
});

// Scale key times around the first key.
AEMCP.register('keyframe.scale_time', function (args) {
    var factor = aemcpNumberArg(args, 'factor');
    if (factor <= 0) {
        aemcpAbortArgs('factor must be greater than 0');
    }
    return aemcpRetimeKeys(args, function (t, first) { return first + (t - first) * factor; });
});

// Keyframe operation handlers (mutating, run via ae_do).
AEMCP.register('keyframe.add', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var time = args && args.time ? args.time : 0;
    // 0 is a valid keyframe value (e.g. opacity off), so test presence, not truthiness.
    var value = args && args.value !== undefined ? args.value : [0, 0];
    var propertyName = args && args.property ? args.property : null;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = aemcpResolveProperty(layer, propertyName);
    if (!prop) return { success: false, error: 'Property not found: ' + propertyName };
    prop.setValueAtTime(time, value);
    return aemcpWithExpressionWarning(prop, { success: true, time: time, property: propertyName });
});

AEMCP.register('keyframe.remove', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var time = args && args.time ? args.time : 0;
    var propertyName = args && args.property ? args.property : null;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = aemcpResolveProperty(layer, propertyName);
    if (!prop) return { success: false, error: 'Property not found: ' + propertyName };
    var j;
    for (j = prop.numKeys; j >= 1; j--) {
        if (Math.abs(prop.keyTime(j) - time) < 0.0001) {
            prop.removeKey(j);
            return { success: true };
        }
    }
    return { success: false, error: 'No keyframe at time ' + time };
});

AEMCP.register('keyframe.set_easing', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var time = args && args.time ? args.time : 0;
    var easing = args && args.easing ? args.easing : 'linear';
    var propertyName = args && args.property ? args.property : null;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = aemcpResolveProperty(layer, propertyName);
    if (!prop) return { success: false, error: 'Property not found: ' + propertyName };
    var keyIndex = null;
    var j;
    for (j = 1; j <= prop.numKeys; j++) {
        if (Math.abs(prop.keyTime(j) - time) < 0.0001) {
            keyIndex = j;
            break;
        }
    }
    if (keyIndex === null) { return { success: false, error: 'No keyframe at time ' + time }; }
    var interp;
    if (easing === 'hold') {
        interp = KeyframeInterpolationType.HOLD;
        prop.setInterpolationTypeAtKey(keyIndex, interp, interp);
    } else if (easing === 'linear') {
        interp = KeyframeInterpolationType.LINEAR;
        prop.setInterpolationTypeAtKey(keyIndex, interp, interp);
    } else {
        interp = KeyframeInterpolationType.BEZIER;
        prop.setInterpolationTypeAtKey(keyIndex, interp, interp);
        var easeAmt = easing === 'easeIn' ? 0 : (easing === 'easeOut' ? 1 : 0.5);
        var easeIn = new KeyframeEase(easeAmt, 33.33);
        var easeOut = new KeyframeEase(1 - easeAmt, 33.33);
        // setTemporalEaseAtKey needs one KeyframeEase per value dimension.
        // Use numDimensions (the definitive AE API) with a fallback.
        var dims = 1;
        try { dims = prop.numDimensions || 1; } catch (e) { dims = 1; }
        var easeInArr = [];
        var easeOutArr = [];
        var d;
        for (d = 0; d < dims; d++) { easeInArr.push(easeIn); easeOutArr.push(easeOut); }
        prop.setTemporalEaseAtKey(keyIndex, easeInArr, easeOutArr);
    }
    return { success: true, easing: easing, keyIndex: keyIndex };
});

// E14-12: apply an easing preset to the keyframes selected on a property.
AEMCP.register('keyframe.ease_preset', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var propertyName = args && args.property ? args.property : null;
    var preset = args && args.preset ? args.preset : null;
    // ponytail: KeyframeEase speed is absolute (units/sec), so a fixed speed means
    // nothing across properties; ease with a flat tangent (speed 0) and influence
    // only, which is scale-independent. The influence values are heuristics — tune
    // them against real AE, or expose custom speed/influence if finer control is needed.
    var curves = { ease_in: [66.67, 0.1], ease_out: [0.1, 66.67], overshoot: [0.1, 85] };
    var curve = curves[preset];
    if (!curve) return { success: false, error: 'Unknown preset: ' + preset };
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = aemcpResolveProperty(layer, propertyName);
    if (!prop) return { success: false, error: 'Property not found: ' + propertyName };
    var selection = prop.selectedKeys || [];
    if (!selection.length) {
        return { success: false, error: 'No keyframes selected on ' + propertyName + '. Select them in the Timeline or Graph Editor first.' };
    }
    var dims = 1;
    try { dims = prop.numDimensions || 1; } catch (e) { dims = 1; }
    var s;
    for (s = 0; s < selection.length; s++) {
        var keyIndex = selection[s];
        prop.setInterpolationTypeAtKey(keyIndex, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        var easeInArr = [];
        var easeOutArr = [];
        for (var d = 0; d < dims; d++) {
            easeInArr.push(new KeyframeEase(0, curve[0]));
            easeOutArr.push(new KeyframeEase(0, curve[1]));
        }
        prop.setTemporalEaseAtKey(keyIndex, easeInArr, easeOutArr);
    }
    return aemcpWithExpressionWarning(prop, { success: true, preset: preset, property: propertyName, keyframes: selection.length });
});

// E14-13: move the anchor point while keeping the layer visually in place.
// The "nine anchor positions" are conveniences; we also accept a literal [x, y]
// in layer coordinates. Use sourceRectAtTime (includes layer bounds in layer space)
// and sourcePointToComp to compute the anchor→comp delta.
// ponytail: this computes the delta in comp space by mapping the old and new anchor
// points through sourcePointToComp. The mock's sourcePointToComp is intentionally
// minimal (no rotation/scale/parent) — the real AE behavior is the source of truth;
// if project geometry uses 3D/parenting, the op's semantics should be validated
// against a real AE run. Upgrade path: fall back to a comp-space projection if
// sourcePointToComp throws or returns NaN in older AE builds.
AEMCP.register('anchor.move_preserving', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var anchor = args && args.anchor !== undefined ? args.anchor : 'center';
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    if (!layer.property) return { success: false, error: 'Not an AV layer' };
    var transform = layer.property(AEMCP_MATCH.TRANSFORM);
    if (!transform) return { success: false, error: 'Transform not found' };
    var anchorProp = transform.property(AEMCP_MATCH.ANCHOR_POINT);
    var posProp = transform.property(AEMCP_MATCH.POSITION);
    if (!anchorProp || !posProp) return { success: false, error: 'Transform properties not found' };
    var bounds;
    try {
        bounds = layer.sourceRectAtTime(layer.time, true);
    } catch (e) {
        bounds = null;
    }
    var newAnchor = null;
    if (Array.isArray(anchor)) {
        newAnchor = [anchor[0], anchor[1]];
    } else if (anchor === 'center') {
        newAnchor = [0, 0];
    } else if (anchor === 'top-left') {
        newAnchor = [bounds ? bounds.left : 0, bounds ? bounds.top : 0];
    } else if (anchor === 'top-center') {
        newAnchor = [bounds ? bounds.left + bounds.width / 2 : 0, bounds ? bounds.top : 0];
    } else if (anchor === 'top-right') {
        newAnchor = [bounds ? bounds.left + bounds.width : 0, bounds ? bounds.top : 0];
    } else if (anchor === 'center-left') {
        newAnchor = [bounds ? bounds.left : 0, bounds ? bounds.top + bounds.height / 2 : 0];
    } else if (anchor === 'center-right') {
        newAnchor = [bounds ? bounds.left + bounds.width : 0, bounds ? bounds.top + bounds.height / 2 : 0];
    } else if (anchor === 'bottom-left') {
        newAnchor = [bounds ? bounds.left : 0, bounds ? bounds.top + bounds.height : 0];
    } else if (anchor === 'bottom-center') {
        newAnchor = [bounds ? bounds.left + bounds.width / 2 : 0, bounds ? bounds.top + bounds.height : 0];
    } else if (anchor === 'bottom-right') {
        newAnchor = [bounds ? bounds.left + bounds.width : 0, bounds ? bounds.top + bounds.height : 0];
    } else {
        return { success: false, error: 'Unknown anchor: ' + anchor };
    }
    var oldAnchor = anchorProp.value;
    var pOld;
    var pNew;
    try {
        pOld = layer.sourcePointToComp(oldAnchor);
        pNew = layer.sourcePointToComp(newAnchor);
    } catch (e) {
        pOld = [oldAnchor[0], oldAnchor[1]];
        pNew = [newAnchor[0], newAnchor[1]];
    }
    var delta = [pNew[0] - pOld[0], pNew[1] - pOld[1]];
    var posVal = posProp.value;
    var posNew = [posVal[0] + delta[0], posVal[1] + delta[1]];
    anchorProp.setValue(newAnchor);
    posProp.setValue(posNew);
    return aemcpWithExpressionWarning(anchorProp, { success: true, anchorPoint: newAnchor });
});

// Expression operation handlers (mutating, run via ae_do).
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyexpression
AEMCP.register('expression.set', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.property ? args.property : null;
    // An empty string is a valid expression (it clears the driver), so test
    // presence, not truthiness.
    var value = args && args.value !== undefined ? args.value : null;
    var layerIndex = args && args.index ? args.index : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = aemcpResolveProperty(layer, propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    // Setting a valid expression auto-enables it; enable explicitly so the mock
    // and real AE agree.
    prop.expression = value;
    prop.expressionEnabled = value !== '';
    return { success: true, expression: prop.expression, enabled: prop.expressionEnabled };
});

AEMCP.register('expression.clear', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.property ? args.property : null;
    var layerIndex = args && args.index ? args.index : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = aemcpResolveProperty(layer, propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    prop.expression = '';
    prop.expressionEnabled = false;
    return { success: true, enabled: prop.expressionEnabled };
});

AEMCP.register('expression.check_errors', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.property ? args.property : null;
    var layerIndex = args && args.index ? args.index : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = aemcpResolveProperty(layer, propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyexpressionerror
    return { success: true, error: prop.expressionError || '' };
});

// E14-14: apply a named expression snippet to a layer property.
// Expression language ref: https://ae-expressions.docsforadobe.dev/objects/property/
// wiggle/loopOut/valueAtTime are documented forms; overshoot is an original
// damped-sine spring built from velocityAtTime + Math (rule 5: no vendor code).
// A numeric snippet parameter: `def` when absent, else a finite number >= min.
function aemcpSnippetNumber(args, key, def, min) {
    var v = args && args[key] !== undefined ? args[key] : def;
    if (typeof v !== 'number' || !isFinite(v) || v < min) {
        aemcpAbortArgs(key + ' must be a number >= ' + min);
    }
    return v;
}

// Expression source for a snippet name, or null when unknown. bounce/inertia
// are original velocityAtTime + Math formulas; time_counter/countdown render
// the comp time as text (Source Text expressions).
function aemcpSnippetCode(name, args) {
    if (name === 'wiggle') return 'wiggle(5, 20)';
    if (name === 'loop') return 'loopOut("cycle")';
    if (name === 'delay') return 'valueAtTime(time - 0.5)';
    if (name === 'overshoot') {
        return 'if (numKeys > 1) { t = time - key(numKeys).time; if (t > 0) { value + velocityAtTime(key(numKeys).time - thisComp.frameDuration) * 0.3 * Math.sin(t * 12) * Math.exp(-t * 6); } else { value; } } else { value; }';
    }
    if (name === 'loop_pingpong') return 'loopOut("pingpong")';
    if (name === 'bounce') {
        var amp = aemcpSnippetNumber(args, 'amplitude', 0.1, 0);
        var freq = aemcpSnippetNumber(args, 'frequency', 2, 0.001);
        var decay = aemcpSnippetNumber(args, 'decay', 5, 0);
        return 'n = 0; if (numKeys > 0) { n = nearestKey(time).index; if (key(n).time > time) n--; } if (n == 0) { value; } else { t = time - key(n).time; value + velocityAtTime(key(n).time - thisComp.frameDuration / 10) * ' + amp + ' * Math.sin(' + freq + ' * t * 2 * Math.PI) / Math.exp(' + decay + ' * t); }';
    }
    if (name === 'inertia') {
        return 'if (numKeys > 1 && time > key(numKeys).time) { t = time - key(numKeys).time; value + velocityAtTime(key(numKeys).time - thisComp.frameDuration / 10) * (1 - Math.exp(-4 * t)) / 4; } else { value; }';
    }
    if (name === 'time_counter') {
        return 'Math.floor(time * ' + aemcpSnippetNumber(args, 'rate', 1, 0.001) + ').toString()';
    }
    if (name === 'countdown') {
        return 'Math.max(0, Math.ceil(' + aemcpSnippetNumber(args, 'from', 10, 0) + ' - time)).toString()';
    }
    return null;
}

AEMCP.register('expression.snippet', function (args) {
    var snippetName = args && args.snippet ? args.snippet : null;
    var code = aemcpSnippetCode(snippetName, args);
    if (!code) {
        return { success: false, error: 'Unknown snippet: ' + snippetName };
    }
    var compName = args && args.comp ? args.comp : null;
    var propertyName = args && args.property ? args.property : null;
    var layerIndex = args && args.index ? args.index : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var prop = aemcpResolveProperty(layer, propertyName);
    if (!prop) return { success: false, error: 'Property not found' };
    // Setting expression auto-enables it when the string is valid (guide), but
    // enable explicitly so the mock and real AE agree.
    prop.expression = code;
    prop.expressionEnabled = true;
    return { success: true, snippet: snippetName, expression: code, enabled: prop.expressionEnabled };
});

// #192: expression-based text animation presets (no text-animator addProperty).
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyexpression
// Ref: https://ae-expressions.docsforadobe.dev/globals/ (linear, ease, inPoint)
AEMCP.register('text.animate', function (args) {
    var preset = args && args.preset ? args.preset : null;
    var duration = aemcpSnippetNumber(args, 'duration', 1, 0.001);
    var comp = aemcpRequireComp(args && args.comp ? args.comp : null);
    var layer = comp.layer(args && args.index ? args.index : 1);
    if (!layer) return { success: false, error: 'Layer not found' };
    var span = 'inPoint, inPoint + ' + duration;
    var prop, code;
    if (preset === 'typewriter') {
        // Ref: https://ae-scripting.docsforadobe.dev/layer/textlayer/
        if (!(layer instanceof TextLayer)) return { success: false, error: 'typewriter needs a text layer' };
        prop = layer.property(AEMCP_MATCH.TEXT_PROPERTIES).property(AEMCP_MATCH.TEXT_DOCUMENT);
        code = 's = value.toString(); s.substr(0, Math.floor(linear(time, ' + span + ', 0, s.length)));';
    } else if (preset === 'fade_in') {
        prop = layer.property(AEMCP_MATCH.TRANSFORM).property(AEMCP_MATCH.OPACITY);
        code = 'linear(time, ' + span + ', 0, 100)';
    } else if (preset === 'slide_up') {
        prop = layer.property(AEMCP_MATCH.TRANSFORM).property(AEMCP_MATCH.POSITION);
        code = 'd = ease(time, ' + span + ', 50, 0); value + ' + (layer.threeDLayer ? '[0, d, 0]' : '[0, d]');
    } else {
        return { success: false, error: 'Unknown preset: ' + preset };
    }
    prop.expression = code;
    prop.expressionEnabled = true;
    return { success: true, preset: preset, property: prop.matchName, expression: code, duration: duration };
});

// #192: lower third = bar (shape.add) + title/subtitle (text.add), each sliding
// in with eased Position keyframes. One undo group (the job's).
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysetvalueattime
AEMCP.register('template.lower_third', function (args) {
    var title = args && typeof args.title === 'string' && args.title !== '' ? args.title : null;
    if (title === null) aemcpAbortArgs('title is required');
    var duration = aemcpSnippetNumber(args, 'duration', 4, 1);
    var compKey = args && args.comp ? args.comp : null;
    var comp = aemcpRequireComp(compKey);
    var x = comp.width * 0.08;
    var y = comp.height * 0.8;
    var barWidth = comp.width * 0.4;
    var made = [];
    var r = AEMCP.HANDLERS['shape.add']({ comp: compKey, type: 'rect', size: [barWidth, 110], fillColor: [0.1, 0.1, 0.1], layerName: 'Lower Third Bar' });
    made.push({ layer: comp.layer(r.layerIndex), pos: [x + barWidth / 2 - 20, y - 25] });
    r = AEMCP.HANDLERS['text.add']({ comp: compKey, text: title, fontSize: 48, fillColor: [1, 1, 1], justification: 'left' });
    made.push({ layer: comp.layer(r.layerIndex), pos: [x, y - 10] });
    if (args.subtitle) {
        r = AEMCP.HANDLERS['text.add']({ comp: compKey, text: args.subtitle, fontSize: 28, fillColor: [0.8, 0.8, 0.8], justification: 'left' });
        made.push({ layer: comp.layer(r.layerIndex), pos: [x, y + 25] });
    }
    var i, m, position, easeIn, easeOut, indices = [];
    for (i = 0; i < made.length; i++) {
        m = made[i];
        m.layer.outPoint = m.layer.inPoint + duration;
        position = m.layer.property(AEMCP_MATCH.TRANSFORM).property(AEMCP_MATCH.POSITION);
        position.setValueAtTime(m.layer.inPoint, [m.pos[0] - barWidth, m.pos[1]]);
        position.setValueAtTime(m.layer.inPoint + 0.5, m.pos);
        // Easy-ease both keys, influence only (as keyframe.ease_preset); a
        // spatial property takes a single KeyframeEase per direction.
        // Ref: https://ae-scripting.docsforadobe.dev/other/keyframeease/
        easeIn = [new KeyframeEase(0, 66.67)];
        easeOut = [new KeyframeEase(0, 66.67)];
        position.setTemporalEaseAtKey(1, easeIn, easeOut);
        position.setTemporalEaseAtKey(2, easeIn, easeOut);
        indices.push(m.layer.index);
    }
    return { success: true, layers: indices };
});

// E14-15: build a controller null with slider controls and parent layers to it.
// Ref: https://ae-scripting.docsforadobe.dev/layer/layercollection/#layercollectionaddnull
// Ref: https://ae-scripting.docsforadobe.dev/property/propertygroup/#propertygroupaddproperty
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerparent
AEMCP.register('rig.null_controller', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var name = args && args.name ? args.name : 'Controller';
    var sliders = args && args.sliders ? args.sliders : [];
    var layerIndices = args && args.layers ? args.layers : [];
    var comp = aemcpRequireComp(compName);
    // Resolve targets before mutating so a bad index leaves the comp untouched.
    var targets = [];
    var j, tl;
    for (j = 0; j < layerIndices.length; j++) {
        tl = comp.layer(layerIndices[j]);
        if (!tl) {
            return { success: false, error: 'Layer not found: ' + layerIndices[j] };
        }
        targets.push(tl);
    }
    var nullLayer = comp.layers.addNull(comp.duration);
    nullLayer.name = name;
    var effects = nullLayer.property(AEMCP_MATCH.EFFECTS);
    var sliderNames = [];
    var k, fx;
    for (k = 0; k < sliders.length; k++) {
        fx = aemcpAddProperty(effects, AEMCP_MATCH.SLIDER_CONTROL);
        fx.name = sliders[k];
        sliderNames.push(sliders[k]);
    }
    for (j = 0; j < targets.length; j++) {
        targets[j].parent = nullLayer;
    }
    return {
        success: true,
        nullIndex: nullLayer.index,
        name: name,
        sliders: sliderNames,
        linked: layerIndices
    };
});

// Effect operation handlers (mutating, run via ae_do). Every op takes a layer
// `index` (default 1) and addresses the effect by `effect` — its display name
// or its stable match name (BACKLOG §2 rule 11). See ADR-0006.
// Ref: https://ae-scripting.docsforadobe.dev/property/propertygroup/#propertygroupaddproperty
// Ref: https://ae-scripting.docsforadobe.dev/property/propertybase/#propertybaseremove
// Ref: https://ae-scripting.docsforadobe.dev/general/application/#appeffects

// The layer's effect parade, or null when the layer has none.
function aemcpEffectParade(layer) {
    var parade = layer.property(AEMCP_MATCH.EFFECTS);
    return aemcpIsGroup(parade) ? parade : null;
}

// The effect on a parade matching a display name or match name, or null.
// Ref: https://ae-scripting.docsforadobe.dev/property/propertygroup/#propertygroupproperty
function aemcpFindEffect(parade, name) {
    if (!aemcpIsGroup(parade) || name === null || name === undefined || name === '') {
        return null;
    }
    var i, effect;
    for (i = 1; i <= parade.numProperties; i++) {
        effect = parade.property(i);
        if (effect && (effect.name === name || effect.matchName === name)) {
            return effect;
        }
    }
    return null;
}

AEMCP.register('effect.apply', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var effectName = args && args.effect ? args.effect : null;
    var layerIndex = args && args.index ? args.index : 1;
    if (!effectName) {
        return { success: false, error: 'Effect required' };
    }
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var parade = aemcpEffectParade(layer);
    if (!parade) return { success: false, error: 'Effect parade not found' };
    // Real AE throws from addProperty for an unknown effect; check first so the
    // caller gets a clean error. The mock has no catalog, so it always allows.
    if (parade.canAddProperty && !parade.canAddProperty(effectName)) {
        return { success: false, error: 'Effect not available: ' + effectName };
    }
    // apply = add: a second apply adds a second copy, matching addProperty.
    var effect = parade.addProperty(effectName);
    return { success: true, effect: { name: effect.name, matchName: effect.matchName } };
});

AEMCP.register('effect.list_on_layer', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var parade = aemcpEffectParade(layer);
    var effects = [];
    if (parade) {
        for (var j = 1; j <= parade.numProperties; j++) {
            var effect = parade.property(j);
            if (!effect) {
                continue;
            }
            effects.push({
                index: j,
                name: effect.name,
                matchName: effect.matchName,
                enabled: !!effect.enabled
            });
        }
    }
    return { success: true, effects: effects };
});

AEMCP.register('effect.list_available', function (args) {
    var effects = [];
    var available = app.effects ? app.effects : [];
    for (var i = 0; i < available.length; i++) {
        effects.push({
            name: available[i].displayName,
            matchName: available[i].matchName,
            category: available[i].category
        });
    }
    return { success: true, effects: effects };
});

AEMCP.register('effect.set_property', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var effectName = args && args.effect ? args.effect : null;
    var propertyName = args && args.property ? args.property : null;
    // 0, [], "" and false are valid values, so test presence, not truthiness.
    var value = args && args.value !== undefined ? args.value : null;
    var layerIndex = args && args.index ? args.index : 1;
    if (!effectName) {
        return { success: false, error: 'Effect required' };
    }
    if (!propertyName) {
        return { success: false, error: 'Property required' };
    }
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var parade = aemcpEffectParade(layer);
    var effect = aemcpFindEffect(parade, effectName);
    if (!effect) return { success: false, error: 'Effect not found: ' + effectName };
    var prop = aemcpResolveProperty(effect, propertyName);
    if (!prop) return { success: false, error: 'Property not found: ' + propertyName };
    prop.setValue(value);
    return aemcpWithExpressionWarning(prop, { success: true });
});

AEMCP.register('effect.set_keyframe', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var effectName = args && args.effect ? args.effect : null;
    var propertyName = args && args.property ? args.property : null;
    var layerIndex = args && args.index ? args.index : 1;
    var time = args && args.time ? args.time : 0;
    var value = args && args.value !== undefined ? args.value : null;
    if (!effectName) {
        return { success: false, error: 'Effect required' };
    }
    if (!propertyName) {
        return { success: false, error: 'Property required' };
    }
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var parade = aemcpEffectParade(layer);
    var effect = aemcpFindEffect(parade, effectName);
    if (!effect) return { success: false, error: 'Effect not found: ' + effectName };
    var prop = aemcpResolveProperty(effect, propertyName);
    if (!prop) return { success: false, error: 'Property not found: ' + propertyName };
    prop.setValueAtTime(time, value);
    return aemcpWithExpressionWarning(prop, { success: true });
});

AEMCP.register('effect.remove', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var effectName = args && args.effect ? args.effect : null;
    var layerIndex = args && args.index ? args.index : 1;
    if (!effectName) {
        return { success: false, error: 'Effect required' };
    }
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var parade = aemcpEffectParade(layer);
    var effect = aemcpFindEffect(parade, effectName);
    if (!effect) return { success: false, error: 'Effect not found: ' + effectName };
    effect.remove();
    return { success: true, removed: effectName };
});

// Preset operation handlers (mutating, run via ae_do).
AEMCP.register('preset.apply_ffx', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && args.index ? args.index : 1;
    var presetPath = args && args.path ? args.path : null;
    var comp = aemcpRequireComp(compName);
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
    var comp = aemcpRequireComp(compName);
    var markerProp;
    if (layerIndex !== null) {
        var markerLayer = comp.layer(layerIndex);
        if (!markerLayer) return { success: false, error: 'Layer not found' };
        markerProp = markerLayer.property(AEMCP_MATCH.MARKER);
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
    var comp = aemcpRequireComp(compName);
    var markerProp;
    if (layerIndex !== null) {
        var markerLayer = comp.layer(layerIndex);
        if (!markerLayer) return { success: false, error: 'Layer not found' };
        markerProp = markerLayer.property(AEMCP_MATCH.MARKER);
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
    var comp = aemcpRequireComp(compName);
    var markerProp;
    if (layerIndex !== null) {
        var markerLayer = comp.layer(layerIndex);
        if (!markerLayer) return { success: false, error: 'Layer not found' };
        markerProp = markerLayer.property(AEMCP_MATCH.MARKER);
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
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var masks = layer.property(AEMCP_MATCH.MASKS);
    if (!masks) return { success: false, error: 'Masks property not found' };
    var newMask = aemcpAddProperty(masks, AEMCP_MATCH.MASK_ATOM);
    if (args && args.vertices) {
        var shape = new Shape();
        shape.vertices = args.vertices;
        if (args.inTangents) shape.inTangents = args.inTangents;
        if (args.outTangents) shape.outTangents = args.outTangents;
        if (typeof args.closed === 'boolean') shape.closed = args.closed;
        newMask.property(AEMCP_MATCH.MASK_SHAPE).setValue(shape);
    }
    return { success: true, maskIndex: newMask.propertyIndex };
});

AEMCP.register('mask.set', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var maskIndex = args && typeof args.maskIndex === 'number' ? args.maskIndex : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var masks = layer.property(AEMCP_MATCH.MASKS);
    var mask = masks ? masks.property(maskIndex) : null;
    if (!mask) return { success: false, error: 'Mask not found' };
    var maskShapeProp = mask.property(AEMCP_MATCH.MASK_SHAPE);
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
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var masks = layer.property(AEMCP_MATCH.MASKS);
    var mask = masks ? masks.property(maskIndex) : null;
    if (!mask) return { success: false, error: 'Mask not found' };
    var shape = mask.property(AEMCP_MATCH.MASK_SHAPE).value;
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
    var comp = aemcpRequireComp(compName);
    var layer;
    if (layerIndex !== null) {
        layer = comp.layer(layerIndex);
    } else {
        layer = comp.layers.addShape();
        if (args && args.layerName) layer.name = args.layerName;
    }
    if (!layer) return { success: false, error: 'Shape layer not found or could not be created' };

    var contents = layer.property(AEMCP_MATCH.SHAPE_ROOT);
    var shapeGroup = aemcpAddProperty(contents, AEMCP_MATCH.SHAPE_GROUP);
    // `name` labels the shape itself; `layerName` names a layer created here (#185).
    if (args && args.name) shapeGroup.name = args.name;
    var groupContents = shapeGroup.property(AEMCP_MATCH.SHAPE_GROUP_CONTENTS);

    if (shapeType === 'rect') {
        var rect = aemcpAddProperty(groupContents, AEMCP_MATCH.SHAPE_RECT);
        if (args.size) rect.property(AEMCP_MATCH.SHAPE_RECT_SIZE).setValue(args.size);
    } else if (shapeType === 'ellipse') {
        var ellipse = aemcpAddProperty(groupContents, AEMCP_MATCH.SHAPE_ELLIPSE);
        if (args.size) ellipse.property(AEMCP_MATCH.SHAPE_ELLIPSE_SIZE).setValue(args.size);
    } else {
        var pathProp = aemcpAddProperty(groupContents, AEMCP_MATCH.SHAPE_PATH);
        if (args.vertices) {
            var myShape = new Shape();
            myShape.vertices = args.vertices;
            if (args.inTangents) myShape.inTangents = args.inTangents;
            if (args.outTangents) myShape.outTangents = args.outTangents;
            if (typeof args.closed === 'boolean') myShape.closed = args.closed;
            pathProp.property(AEMCP_MATCH.SHAPE_PATH_VALUE).setValue(myShape);
        }
    }

    if (args && args.fillColor) {
        var fill = aemcpAddProperty(groupContents, AEMCP_MATCH.SHAPE_FILL);
        fill.property(AEMCP_MATCH.SHAPE_FILL_COLOR).setValue(args.fillColor);
    }
    if (args && args.strokeColor) {
        var stroke = aemcpAddProperty(groupContents, AEMCP_MATCH.SHAPE_STROKE);
        stroke.property(AEMCP_MATCH.SHAPE_STROKE_COLOR).setValue(args.strokeColor);
        if (typeof args.strokeWidth === 'number') {
            stroke.property(AEMCP_MATCH.SHAPE_STROKE_WIDTH).setValue(args.strokeWidth);
        }
    }
    return { success: true, layerIndex: layer.index };
});

AEMCP.register('shape.set', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var contents = layer.property(AEMCP_MATCH.SHAPE_ROOT);
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
        if (group && group.property(AEMCP_MATCH.SHAPE_GROUP_CONTENTS)) {
            var p = group.property(AEMCP_MATCH.SHAPE_GROUP_CONTENTS).property(AEMCP_MATCH.SHAPE_PATH);
            if (p) p.property(AEMCP_MATCH.SHAPE_PATH_VALUE).setValue(myShape);
        }
    }
    return { success: true };
});

AEMCP.register('shape.read', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var contents = layer.property(AEMCP_MATCH.SHAPE_ROOT);
    var details = { numGroups: contents ? contents.numProperties : 0 };
    return { shape: details };
});

// Map a friendly justification name to the ParagraphJustification enum.
// Ref: https://ae-scripting.docsforadobe.dev/text/textdocument/#textdocumentjustification
function aemcpJustificationValue(name) {
    if (name === 'left') return ParagraphJustification.LEFT_JUSTIFY;
    if (name === 'center') return ParagraphJustification.CENTER_JUSTIFY;
    if (name === 'right') return ParagraphJustification.RIGHT_JUSTIFY;
    if (name === 'justify') return ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT;
    return null;
}

// Map a ParagraphJustification enum value back to a friendly name.
function aemcpJustificationName(value) {
    if (value === ParagraphJustification.CENTER_JUSTIFY) return 'center';
    if (value === ParagraphJustification.RIGHT_JUSTIFY) return 'right';
    if (value === ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT ||
        value === ParagraphJustification.FULL_JUSTIFY_LASTLINE_RIGHT ||
        value === ParagraphJustification.FULL_JUSTIFY_LASTLINE_CENTER ||
        value === ParagraphJustification.FULL_JUSTIFY_LASTLINE_FULL) {
        return 'justify';
    }
    return 'left';
}

// Copy every present style argument onto a TextDocument. Returns { changed } or
// { error } so callers only setValue when something actually changed.
// Ref: https://ae-scripting.docsforadobe.dev/text/textdocument/
function aemcpApplyTextStyle(textDoc, args) {
    var changed = false;
    if (args.text !== undefined) { textDoc.text = args.text; changed = true; }
    if (args.fontSize !== undefined) { textDoc.fontSize = args.fontSize; changed = true; }
    if (args.fillColor !== undefined) { textDoc.fillColor = args.fillColor; changed = true; }
    if (args.font !== undefined) { textDoc.font = args.font; changed = true; }
    if (args.tracking !== undefined) { textDoc.tracking = args.tracking; changed = true; }
    if (args.leading !== undefined) { textDoc.leading = args.leading; changed = true; }
    if (args.justification !== undefined) {
        var justification = aemcpJustificationValue(args.justification);
        if (justification === null) {
            return { error: 'Unknown justification: ' + args.justification };
        }
        textDoc.justification = justification;
        changed = true;
    }
    return { changed: changed };
}

AEMCP.register('text.add', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var textString = args && args.text ? args.text : 'Text';
    var comp = aemcpRequireComp(compName);
    var textLayer = comp.layers.addText(textString);
    var textProp = textLayer.property('Source Text');
    var textDoc = textProp.value;
    var result = aemcpApplyTextStyle(textDoc, args || {});
    if (result.error) return { success: false, error: result.error };
    if (result.changed) textProp.setValue(textDoc);
    return { success: true, layerIndex: textLayer.index };
});

AEMCP.register('text.set', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var textProp = layer.property('Source Text');
    if (!textProp) return { success: false, error: 'Source Text not found' };
    var textDoc = textProp.value;
    var result = aemcpApplyTextStyle(textDoc, args || {});
    if (result.error) return { success: false, error: result.error };
    if (result.changed) textProp.setValue(textDoc);
    return { success: true };
});

AEMCP.register('text.read', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var comp = aemcpRequireComp(compName);
    var layer = comp.layer(layerIndex);
    if (!layer) return { success: false, error: 'Layer not found' };
    var textProp = layer.property('Source Text');
    if (!textProp) return { success: false, error: 'Source Text not found' };
    var textDoc = textProp.value;
    return {
        text: textDoc.text,
        fontSize: textDoc.fontSize,
        font: textDoc.font,
        fontFamily: textDoc.fontFamily,
        fontStyle: textDoc.fontStyle,
        justification: aemcpJustificationName(textDoc.justification),
        tracking: textDoc.tracking,
        leading: textDoc.leading
    };
});

// Audio operation handlers (mutating/reading, run via ae_do).
// Ref: https://ae-scripting.docsforadobe.dev/layers/avLayer.html
AEMCP.register('audio.set_levels', function (args) {
    var compName = args && args.comp ? args.comp : null;
    var layerIndex = args && typeof args.layerIndex === 'number' ? args.layerIndex : 1;
    var levels = args && args.levels ? args.levels : [0, 0];
    var comp = aemcpRequireComp(compName);
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
    var comp = aemcpRequireComp(compName);
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
    var comp = aemcpRequireComp(compName);
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
        parade = layer.property(AEMCP_MATCH.EFFECTS);
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
            aemcpAddProperty(parade, effectName);
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
            var keyData = aemcpReadKeys(prop);
            var fromTimes = aemcpKeyTimes(keyData);
            var toTimes = [];
            var k;
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
                        keyData[k].time = toTimes[k];
                    }
                    aemcpWriteKeys(prop, keyData);
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

// Remove every item that no composition uses (reusing the report from
// E9-8). Comps and folders are never removed. Deleting goes right-to-left so
// earlier item indices stay valid as the project shrinks.
// Ref: https://ae-scripting.docsforadobe.dev/item/item/#itemremove
AEMCP.register('bulk.remove_unused', function (args) {
    var project = app.project;
    var dryRun = !(args && args.dryRun === false);
    var unused = aemcpUnusedItems(project);
    var byId = {};
    var ids = [];
    var i, u, item;
    for (u = 0; u < unused.length; u++) {
        byId[unused[u].id] = unused[u];
        ids.push(unused[u].id);
    }
    ids.sort(function (a, b) { return a - b; });
    var changes = [];
    for (i = project.numItems; i >= 1; i--) {
        item = project.item(i);
        if (byId[item.id]) {
            changes.push({ id: item.id, name: item.name, type: byId[item.id].type });
            if (!dryRun) {
                item.remove();
            }
        }
    }
    var fingerprint = 'remove-unused:' + ids.join(',') + '#' + unused.length;
    if (dryRun) {
        return {
            dryRun: true,
            changes: changes,
            fingerprint: fingerprint
        };
    }
    return {
        dryRun: false,
        removed: changes.length,
        changes: changes,
        fingerprint: fingerprint
    };
});

// Duplicate a composition with a new name and an optional new size, planned
// and applied like the other bulk ops. Width and height default to the source
// comp; the fingerprint covers the source name and the requested result.
// Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemduplicate
// Ref: https://ae-scripting.docsforadobe.dev/item/avitem/#avitemwidth
AEMCP.register('bulk.duplicate_comp', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var name = args && args.name ? args.name : '';
    if (name === '') {
        aemcpAbortArgs('name is required');
    }
    var width = args && typeof args.width === 'number' ? args.width : comp.width;
    var height = args && typeof args.height === 'number' ? args.height : comp.height;
    if (width !== Math.floor(width) || width < 1 || width > 30000) {
        aemcpAbortArgs('width must be an integer from 1 to 30000');
    }
    if (height !== Math.floor(height) || height < 1 || height > 30000) {
        aemcpAbortArgs('height must be an integer from 1 to 30000');
    }
    var dryRun = !(args && args.dryRun === false);
    var fingerprint = 'duplicate:' + comp.name + '#' + width + 'x' + height + '>' + name;
    var change = { from: comp.name, to: { name: name, width: width, height: height } };
    if (dryRun) {
        return { dryRun: true, changes: [change], fingerprint: fingerprint };
    }
    var copy = comp.duplicate();
    copy.name = name;
    copy.width = width;
    copy.height = height;
    return {
        dryRun: false,
        createdId: copy.id,
        created: { id: copy.id, name: name, width: width, height: height },
        changes: [change],
        fingerprint: fingerprint
    };
});

// The project item matching an id number or an exact name, or null.
function aemcpFindItem(key) {
    var project = app.project;
    var i, item;
    for (i = 1; i <= project.numItems; i++) {
        item = project.item(i);
        if ((typeof key === 'number' && item.id === key) || (typeof key === 'string' && item.name === key)) {
            return item;
        }
    }
    return null;
}

// A folder item at the project root with the given name, or null.
function aemcpFindFolder(name) {
    var project = app.project;
    var i, item;
    for (i = 1; i <= project.numItems; i++) {
        item = project.item(i);
        if (item instanceof FolderItem && item.name === name) {
            return item;
        }
    }
    return null;
}

// Move items into project folders, creating a missing folder at the root.
// Each spec is {name, items}, where items are matched by id number or exact
// name; unmatched identifiers are skipped. Planned and applied like the other
// bulk ops; the fingerprint covers every requested folder name and the
// resolved item ids.
// Ref: https://ae-scripting.docsforadobe.dev/item/item/#itemparentfolder
// Ref: https://ae-scripting.docsforadobe.dev/itemCollection/itemCollection.html#itemcollection-addfolder
AEMCP.register('bulk.organize_items', function (args) {
    var folders = args && args.folders ? args.folders : null;
    if (!folders || folders.length === 0) {
        aemcpAbortArgs('folders is required');
    }
    var dryRun = !(args && args.dryRun === false);
    var changes = [];
    var parts = [];
    var f, t, spec, item, folder;
    for (f = 0; f < folders.length; f++) {
        spec = folders[f];
        if (!spec || typeof spec.name !== 'string' || spec.name === '') {
            aemcpAbortArgs('every folder needs a name');
        }
        if (!spec.items || spec.items.length === 0) {
            aemcpAbortArgs('folder ' + spec.name + ' needs items');
        }
        folder = aemcpFindFolder(spec.name);
        if (folder === null && !dryRun) {
            folder = app.project.items.addFolder(spec.name);
        }
        for (t = 0; t < spec.items.length; t++) {
            item = aemcpFindItem(spec.items[t]);
            if (item === null) {
                continue;
            }
            if (folder !== null && item.parentFolder && item.parentFolder.name === folder.name) {
                continue;
            }
            parts.push(spec.name + ':' + item.id);
            changes.push({
                id: item.id,
                name: item.name,
                from: item.parentFolder ? item.parentFolder.name : '',
                to: spec.name
            });
            if (!dryRun) {
                item.parentFolder = folder;
            }
        }
    }
    var fingerprint = 'organize:' + parts.join(',');
    if (dryRun) {
        return { dryRun: true, changes: changes, fingerprint: fingerprint };
    }
    return {
        dryRun: false,
        moved: changes.length,
        changes: changes,
        fingerprint: fingerprint
    };
});

// Batch resize a composition into several named formats, each an independent
// duplicate at its own size (like bulk.duplicate_comp but for many outputs).
// Planned and applied through ae_plan/ae_apply; the fingerprint covers the
// source name plus every requested format.
// Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemduplicate
// Ref: https://ae-scripting.docsforadobe.dev/item/avitem/#avitemwidth
AEMCP.register('bulk.resize_comp', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var formats = args && args.formats ? args.formats : null;
    if (!formats || formats.length === 0) {
        aemcpAbortArgs('formats is required');
    }
    var dryRun = !(args && args.dryRun === false);
    var changes = [];
    var created = [];
    var parts = [];
    var f, spec, copy;
    for (f = 0; f < formats.length; f++) {
        spec = formats[f];
        if (!spec || typeof spec.name !== 'string' || spec.name === '') {
            aemcpAbortArgs('every format needs a name');
        }
        if (typeof spec.width !== 'number' || spec.width !== Math.floor(spec.width) || spec.width < 1 || spec.width > 30000) {
            aemcpAbortArgs('format ' + spec.name + ' needs an integer width from 1 to 30000');
        }
        if (typeof spec.height !== 'number' || spec.height !== Math.floor(spec.height) || spec.height < 1 || spec.height > 30000) {
            aemcpAbortArgs('format ' + spec.name + ' needs an integer height from 1 to 30000');
        }
        parts.push(spec.name + ':' + spec.width + 'x' + spec.height);
        changes.push({ from: comp.name, to: { name: spec.name, width: spec.width, height: spec.height } });
        if (!dryRun) {
            copy = comp.duplicate();
            copy.name = spec.name;
            copy.width = spec.width;
            copy.height = spec.height;
            created.push({ id: copy.id, name: spec.name, width: spec.width, height: spec.height });
        }
    }
    var fingerprint = 'resize:' + comp.name + '#' + parts.join(',');
    if (dryRun) {
        return { dryRun: true, changes: changes, fingerprint: fingerprint };
    }
    return {
        dryRun: false,
        applied: created.length,
        created: created,
        changes: changes,
        fingerprint: fingerprint
    };
});



// Import files into the project. Every file is checked first: one missing file
// aborts with INVALID_ARGS and nothing is imported. An optional `folder` names
// a root project folder (created if missing) that receives the new items.
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectimportfile
// Ref: https://ae-scripting.docsforadobe.dev/other/importoptions/
// Ref: https://ae-scripting.docsforadobe.dev/item/item/#itemparentfolder
AEMCP.register('project.import_file', function (args) {
    var paths = args && args.paths ? args.paths : [];
    if (args && typeof args.path === 'string') {
        paths = paths.concat([args.path]);
    }
    if (paths.length === 0) {
        aemcpAbortArgs('path or paths is required');
    }
    var i, items = [], item, folder = null;
    for (i = 0; i < paths.length; i++) {
        if (typeof paths[i] !== 'string' || !new File(paths[i]).exists) {
            aemcpAbortArgs('file not found: ' + paths[i]);
        }
    }
    if (args.folder !== undefined && args.folder !== '') {
        folder = aemcpFindFolder(args.folder) || app.project.items.addFolder(args.folder);
    }
    for (i = 0; i < paths.length; i++) {
        item = app.project.importFile(new ImportOptions(new File(paths[i])));
        if (folder !== null) {
            item.parentFolder = folder;
        }
        items.push({ id: item.id, name: item.name, type: aemcpItemType(item) });
    }
    return { items: items };
});

// Swap the source file of a footage item matched by id number or exact name.
// Ref: https://ae-scripting.docsforadobe.dev/item/footageitem/#footageitemreplace
AEMCP.register('footage.replace', function (args) {
    var item = args ? aemcpFindItem(args.item) : null;
    if (item === null || !(item instanceof FootageItem)) {
        aemcpAbortArgs('footage item not found: ' + (args ? args.item : ''));
    }
    if (typeof args.path !== 'string' || !new File(args.path).exists) {
        aemcpAbortArgs('file not found: ' + args.path);
    }
    item.replace(new File(args.path));
    return { id: item.id, name: item.name };
});
