// Serializers for items, folders and compositions. Read-only; no side effects.
// ES3 only (ExtendScript): var, no Array extras beyond the shipped polyfills.
function aemcpRound(value) {
    return Math.round(value * 1000) / 1000;
}

// Reads a property's value without failing the call: NO_VALUE properties (e.g. Gradient Ramp
// ADBE Ramp-0008) and any read that throws come back as null.
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertypropertyvaluetype
function aemcpSafeValue(prop) {
    if (prop.propertyValueType === PropertyValueType.NO_VALUE) {
        return null;
    }
    try {
        return prop.value;
    } catch (e) {
        return null;
    }
}

function aemcpItemType(item) {
    if (item instanceof CompItem) {
        return 'Composition';
    }
    if (item instanceof FolderItem) {
        return 'Folder';
    }
    return 'Footage';
}

function aemcpSerializeItem(item) {
    var folder = item.parentFolder;
    return {
        id: item.id,
        name: item.name,
        type: aemcpItemType(item),
        parentFolderId: folder.id,
        parentFolderName: folder.name,
        label: item.label,
        comment: item.comment
    };
}

function aemcpSerializeCompItem(item) {
    var summary = aemcpSerializeItem(item);
    summary.width = item.width;
    summary.height = item.height;
    summary.pixelAspect = aemcpRound(item.pixelAspect);
    summary.frameRate = aemcpRound(item.frameRate);
    summary.duration = aemcpRound(item.duration);
    summary.bgColor = [item.bgColor[0], item.bgColor[1], item.bgColor[2]];
    summary.numLayers = item.numLayers;
    summary.workAreaStart = aemcpRound(item.workAreaStart);
    summary.workAreaDuration = aemcpRound(item.workAreaDuration);
    summary.motionBlur = item.motionBlur;
    return summary;
}

function aemcpSerializeProject() {    var project = app.project;
    var items = [];
    var i;
    for (i = 1; i <= project.numItems; i++) {
        items.push(aemcpSerializeItem(project.item(i)));
    }
    var active = null;
    if (project.activeItem) {
        active = aemcpSerializeItem(project.activeItem);
    }
    return {
        file: project.file ? project.file.fsName : null,
        numItems: project.numItems,
        bitsPerChannel: project.bitsPerChannel,
        activeItem: active,
        items: items
    };
}

function aemcpIsGroup(value) {
    return value !== null && value !== undefined && typeof value.numProperties === 'number';
}

function aemcpCoerceValue(value) {
    if (value === null || value === undefined) {
        return null;
    }
    var type = typeof value;
    if (type === 'number' || type === 'string' || type === 'boolean') {
        return value;
    }
    if (typeof value.length === 'number') {
        var out = [];
        var i;
        for (i = 0; i < value.length; i++) {
            out.push(aemcpCoerceValue(value[i]));
        }
        return out;
    }
    if (typeof value.text === 'string' && typeof value.fontSize === 'number') {
        return {
            __kind: 'TextDocument',
            text: value.text,
            fontSize: aemcpRound(value.fontSize),
            font: value.font,
            fillColor: [
                aemcpRound(value.fillColor[0]),
                aemcpRound(value.fillColor[1]),
                aemcpRound(value.fillColor[2])
            ]
        };
    }
    return null;
}

function aemcpSerializeProperty(property) {
    var out = { name: property.name, matchName: property.matchName };
    if (typeof property.numKeys === 'number' && property.numKeys > 0) {
        var keyframes = [];
        var i;
        for (i = 1; i <= property.numKeys; i++) {
            keyframes.push({
                time: aemcpRound(property.keyTime(i)),
                value: aemcpCoerceValue(property.keyValue(i))
            });
        }
        out.keyframes = keyframes;
    } else {
        out.value = aemcpCoerceValue(aemcpSafeValue(property));
    }
    if (property.expressionEnabled && property.expression) {
        out.expression = property.expression;
    }
    return out;
}

// X/Y/Z Position exist on every layer but only mean something once Position's dimensions
// are separated; otherwise AE reports them as 0, which reads like a real position.
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyisseparationfollower
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyseparationleader
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertydimensionsseparated
function aemcpUnusedSeparationFollower(property) {
    return property.isSeparationFollower === true && !!property.separationLeader &&
        property.separationLeader.dimensionsSeparated !== true;
}

function aemcpSerializePropertyGroup(group) {
    var properties = [];
    var groups = [];
    var i;
    for (i = 1; i <= group.numProperties; i++) {
        var child = group.property(i);
        if (aemcpIsGroup(child)) {
            groups.push(aemcpSerializePropertyGroup(child));
        } else if (!aemcpUnusedSeparationFollower(child)) {
            properties.push(aemcpSerializeProperty(child));
        }
    }
    return {
        name: group.name,
        matchName: group.matchName,
        properties: properties,
        groups: groups
    };
}

function aemcpSerializeEffects(layer) {
    var parade = layer.property(AEMCP_MATCH.EFFECTS);
    var effects = [];
    var i;
    if (!aemcpIsGroup(parade)) {
        return effects;
    }
    for (i = 1; i <= parade.numProperties; i++) {
        var effect = parade.property(i);
        var group = aemcpSerializePropertyGroup(effect);
        effects.push({
            name: group.name,
            matchName: group.matchName,
            enabled: effect.enabled ? aemcpSafeValue(effect.enabled) !== false : true,
            properties: group.properties
        });
    }
    return effects;
}

function aemcpSerializeMasks(layer) {
    var parade = layer.property(AEMCP_MATCH.MASKS);
    var masks = [];
    var i;
    if (!aemcpIsGroup(parade)) {
        return masks;
    }
    for (i = 1; i <= parade.numProperties; i++) {
        masks.push(aemcpSerializePropertyGroup(parade.property(i)));
    }
    return masks;
}

function aemcpSerializeMarkers(layer) {
    var markers = [];
    var group = layer.property('Marker');
    var i, value;
    // Marker properties expose numKeys; a group's numProperties is not reliable here.
    if (group === null || group === undefined || typeof group.numKeys !== 'number') {
        return markers;
    }
    for (i = 1; i <= group.numKeys; i++) {
        value = group.keyValue(i);
        markers.push({
            time: aemcpRound(group.keyTime(i)),
            duration: aemcpRound(value.duration),
            comment: value.comment
        });
    }
    return markers;
}

function aemcpSerializeText(layer) {
    var text = layer.property(AEMCP_MATCH.TEXT_PROPERTIES);
    if (!aemcpIsGroup(text)) {
        return null;
    }
    var source = text.property(AEMCP_MATCH.TEXT_DOCUMENT);
    var sourceValue = source ? aemcpSafeValue(source) : null;
    if (typeof sourceValue !== 'object' || sourceValue === null) {
        return null;
    }
    var document = sourceValue;
    return {
        text: document.text,
        fontSize: aemcpRound(document.fontSize),
        font: document.font,
        fillColor: [
            aemcpRound(document.fillColor[0]),
            aemcpRound(document.fillColor[1]),
            aemcpRound(document.fillColor[2])
        ]
    };
}

function aemcpLayerType(layer) {
    if (layer instanceof TextLayer) {
        return 'TextLayer';
    }
    if (layer instanceof ShapeLayer) {
        return 'ShapeLayer';
    }
    if (layer instanceof CameraLayer) {
        return 'CameraLayer';
    }
    if (layer instanceof LightLayer) {
        return 'LightLayer';
    }
    if (layer instanceof AVLayer) {
        return 'AVLayer';
    }
    return 'Layer';
}

function aemcpSerializeLayer(layer) {
    var out = {
        index: layer.index,
        id: layer.id === undefined ? null : layer.id,
        name: layer.name,
        type: aemcpLayerType(layer),
        enabled: layer.enabled,
        solo: layer.solo,
        shy: layer.shy,
        locked: layer.locked,
        inPoint: aemcpRound(layer.inPoint),
        outPoint: aemcpRound(layer.outPoint),
        startTime: aemcpRound(layer.startTime),
        stretch: aemcpRound(layer.stretch),
        parentIndex: layer.parent ? layer.parent.index : null,
        label: layer.label,
        // Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layernulllayer
        nullLayer: layer.nullLayer === true
    };
    if (layer instanceof AVLayer) {
        out.width = layer.width;
        out.height = layer.height;
        out.hasVideo = layer.hasVideo;
        out.hasAudio = layer.hasAudio;
        out.threeDLayer = layer.threeDLayer;
        out.sourceId = layer.source ? layer.source.id : null;
        out.sourceName = layer.source ? layer.source.name : null;
        // Ref: https://ae-scripting.docsforadobe.dev/sources/solidsource/
        if (layer.source && layer.source.mainSource instanceof SolidSource) {
            out.solidColor = aemcpCoerceValue(layer.source.mainSource.color);
        }
    }
    var transform = layer.property(AEMCP_MATCH.TRANSFORM);
    if (aemcpIsGroup(transform)) {
        out.transform = aemcpSerializePropertyGroup(transform);
    }
    out.effects = aemcpSerializeEffects(layer);
    out.masks = aemcpSerializeMasks(layer);
    out.markers = aemcpSerializeMarkers(layer);
    if (layer instanceof TextLayer) {
        var text = aemcpSerializeText(layer);
        if (text) {
            out.text = text;
        }
    }
    return out;
}

// Compact layer report for ae_layer_info (#250). The default report drops empty
// arrays and empty transform groups (transform values are always kept). `full` keeps everything; `fields` selects top-level keys; `summary`
// returns index, name and type only. Only the match names compared below are checked,
// so any other property is always kept.
var AEMCP_LAYER_FIELDS = [
    'index', 'id', 'name', 'type', 'enabled', 'solo', 'shy', 'locked', 'inPoint', 'outPoint',
    'startTime', 'stretch', 'parentIndex', 'label', 'nullLayer', 'width', 'height', 'hasVideo',
    'hasAudio', 'threeDLayer', 'sourceId', 'sourceName', 'solidColor', 'transform', 'effects',
    'masks', 'markers', 'text'
];

// Drops empty transform groups and empty arrays from a serialized layer, in place.
function aemcpCompactLayer(out) {
    var keys = ['effects', 'masks', 'markers'];
    var i;
    if (out.transform) {
        // Transform values are always kept: leaving Position or Anchor Point out at their
        // defaults read as "missing" to callers. Only empty groups and arrays are dropped.
        if (out.transform.properties.length === 0) {
            delete out.transform.properties;
        }
        if (out.transform.groups.length === 0) {
            delete out.transform.groups;
        }
    }
    for (i = 0; i < keys.length; i++) {
        if (out[keys[i]].length === 0) {
            delete out[keys[i]];
        }
    }
    return out;
}

// Checks the compact-report arguments of ae_layer_info and returns them normalised.
function aemcpLayerReportOptions(args) {
    var options = { full: !!(args && args.full), summary: !!(args && args.summary), fields: null };
    var i, j, known;
    if (args && args.fields) {
        if (typeof args.fields.length !== 'number') {
            aemcpAbortArgs('fields must be an array of layer field names');
        }
        for (i = 0; i < args.fields.length; i++) {
            known = false;
            for (j = 0; j < AEMCP_LAYER_FIELDS.length; j++) {
                if (AEMCP_LAYER_FIELDS[j] === args.fields[i]) {
                    known = true;
                }
            }
            if (!known) {
                aemcpAbortArgs('unknown layer field: ' + args.fields[i]);
            }
        }
        options.fields = args.fields;
    }
    return options;
}

// Builds one ae_layer_info entry from a full serialized layer.
function aemcpLayerReport(out, comp, options) {
    var picked, i;
    if (options.summary) {
        return { index: out.index, name: out.name, type: out.type };
    }
    if (!options.full) {
        aemcpCompactLayer(out);
    }
    if (!options.fields) {
        return out;
    }
    picked = { index: out.index };
    for (i = 0; i < options.fields.length; i++) {
        if (out.hasOwnProperty(options.fields[i])) {
            picked[options.fields[i]] = out[options.fields[i]];
        }
    }
    return picked;
}

AEMCP.serialize = {};
AEMCP.serialize.project = aemcpSerializeProject;
AEMCP.serialize.item = aemcpSerializeItem;
AEMCP.serialize.comp = aemcpSerializeCompItem;
AEMCP.serialize.layer = aemcpSerializeLayer;
AEMCP.serialize.property = aemcpSerializeProperty;

// Snapshot serializer used by project.export_json: a full dump of the item
// tree, comp settings and every layer, so project.import_json (E7-6) can
// rebuild the structure. Read-only; no side effects.
function aemcpSerializeSnapshotComp(item) {
    var out = aemcpSerializeCompItem(item);
    var layers = [];
    var i;
    for (i = 1; i <= item.numLayers; i++) {
        layers.push(aemcpSerializeLayer(item.layer(i)));
    }
    out.layers = layers;
    return out;
}

function aemcpSerializeSnapshotItem(item) {
    if (item instanceof CompItem) {
        return aemcpSerializeSnapshotComp(item);
    }
    if (item instanceof FolderItem) {
        return aemcpSerializeItem(item);
    }
    // FootageItem.
    var out = aemcpSerializeItem(item);
    if (item.file && item.file.fsName) {
        out.file = item.file.fsName;
    }
    return out;
}

function aemcpSerializeProjectSnapshot() {
    var project = app.project;
    var items = [];
    var i;
    for (i = 1; i <= project.numItems; i++) {
        items.push(aemcpSerializeSnapshotItem(project.item(i)));
    }
    return {
        format: 'aemcp-project/v1',
        file: project.file ? project.file.fsName : null,
        numItems: project.numItems,
        bitsPerChannel: project.bitsPerChannel,
        items: items
    };
}

AEMCP.serialize.projectSnapshot = aemcpSerializeProjectSnapshot;
