// Serializers for items, folders and compositions. Read-only; no side effects.
// ES3 only (ExtendScript): var, no Array extras beyond the shipped polyfills.
function aemcpRound(value) {
    return Math.round(value * 1000) / 1000;
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
        out.value = aemcpCoerceValue(property.value);
    }
    if (property.expressionEnabled && property.expression) {
        out.expression = property.expression;
    }
    return out;
}

function aemcpSerializePropertyGroup(group) {
    var properties = [];
    var groups = [];
    var i;
    for (i = 1; i <= group.numProperties; i++) {
        var child = group.property(i);
        if (aemcpIsGroup(child)) {
            groups.push(aemcpSerializePropertyGroup(child));
        } else {
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
    var parade = layer.property('ADBE Effect Parade');
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
            enabled: effect.enabled ? effect.enabled.value : true,
            properties: group.properties
        });
    }
    return effects;
}

function aemcpSerializeMasks(layer) {
    var parade = layer.property('ADBE Mask Parade');
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

function aemcpSerializeText(layer) {
    var text = layer.property('ADBE Text Properties');
    if (!aemcpIsGroup(text)) {
        return null;
    }
    var source = text.property('ADBE Text Document');
    if (!source || typeof source.value !== 'object' || source.value === null) {
        return null;
    }
    var document = source.value;
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
        label: layer.label
    };
    if (layer instanceof AVLayer) {
        out.width = layer.width;
        out.height = layer.height;
        out.hasVideo = layer.hasVideo;
        out.hasAudio = layer.hasAudio;
        out.threeDLayer = layer.threeDLayer;
        out.sourceId = layer.source ? layer.source.id : null;
        out.sourceName = layer.source ? layer.source.name : null;
    }
    var transform = layer.property('ADBE Transform Group');
    if (aemcpIsGroup(transform)) {
        out.transform = aemcpSerializePropertyGroup(transform);
    }
    out.effects = aemcpSerializeEffects(layer);
    out.masks = aemcpSerializeMasks(layer);
    if (layer instanceof TextLayer) {
        var text = aemcpSerializeText(layer);
        if (text) {
            out.text = text;
        }
    }
    return out;
}

AEMCP.serialize = {};
AEMCP.serialize.project = aemcpSerializeProject;
AEMCP.serialize.item = aemcpSerializeItem;
AEMCP.serialize.comp = aemcpSerializeCompItem;
AEMCP.serialize.layer = aemcpSerializeLayer;
AEMCP.serialize.property = aemcpSerializeProperty;
