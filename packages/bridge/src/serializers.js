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

function aemcpSerializeProject() {
    var project = app.project;
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

AEMCP.serialize = {};
AEMCP.serialize.project = aemcpSerializeProject;
AEMCP.serialize.item = aemcpSerializeItem;
AEMCP.serialize.comp = aemcpSerializeCompItem;
