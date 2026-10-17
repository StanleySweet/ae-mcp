// Collect the files under a folder, skipping names that start with '.'.
// Sub-folders are entered only when recursive is true. Folder.getFiles returns
// File and Folder objects; Folder entries are told apart with instanceof.
// Ref: Folder is the File System object (not in the scripting guide); used the
// same way by job-runner.js, which calls getFiles on a Folder.
function aemcpCollectFolderFiles(folder, recursive, out) {
    var entries = folder.getFiles();
    var i, entry;
    for (i = 0; i < entries.length; i++) {
        entry = entries[i];
        if (entry.name.charAt(0) === '.') {
            continue;
        }
        if (entry instanceof Folder) {
            if (recursive) {
                aemcpCollectFolderFiles(entry, true, out);
            }
        } else {
            out.push(entry);
        }
    }
    return out;
}

// Import every visible file under a folder into a project folder named by
// `folder`, or by the source folder when omitted. A file AE refuses is listed in
// `skipped` instead of aborting the batch.
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectimportfile
// Ref: https://ae-scripting.docsforadobe.dev/other/importoptions/
// Ref: https://ae-scripting.docsforadobe.dev/item/item/#itemparentfolder
AEMCP.register('project.import_folder', function (args) {
    if (!args || typeof args.path !== 'string' || args.path === '') {
        aemcpAbortArgs('path is required');
    }
    var source = new Folder(args.path);
    if (!source.exists) {
        aemcpAbortArgs('folder not found: ' + args.path);
    }
    var folderName = typeof args.folder === 'string' && args.folder !== '' ? args.folder : source.name;
    var folder = aemcpFindFolder(folderName) || app.project.items.addFolder(folderName);
    var files = aemcpCollectFolderFiles(source, args.recursive === true, []);
    var items = [], skipped = [], i, item;
    for (i = 0; i < files.length; i++) {
        try {
            item = app.project.importFile(new ImportOptions(files[i]));
        } catch (e) {
            skipped.push({ path: files[i].fsName, reason: String(e && e.message ? e.message : e) });
            continue;
        }
        item.parentFolder = folder;
        items.push({ id: item.id, name: item.name, type: aemcpItemType(item) });
    }
    return { items: items, skipped: skipped };
});

// Reduce the project to the given comps: everything else is removed.
// Each entry is a comp id or an exact name; any miss aborts before anything is
// removed.
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectreduceproject
AEMCP.register('project.reduce', function (args) {
    var keys = args && args.items ? args.items : null;
    if (!keys || !(keys instanceof Array) || keys.length === 0) {
        aemcpAbortArgs('items is required');
    }
    var comps = [], i, item;
    for (i = 0; i < keys.length; i++) {
        item = aemcpFindItem(keys[i]);
        if (item === null) {
            aemcpAbortArgs('composition not found: ' + keys[i]);
        }
        if (!(item instanceof CompItem)) {
            aemcpAbortArgs('not a composition: ' + keys[i]);
        }
        comps.push(item);
    }
    var removed = app.project.reduceProject(comps);
    return { removed: removed, numItems: app.project.numItems };
});

// Consolidate all footage in the project (File > Consolidate All Footage).
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectconsolidatefootage
AEMCP.register('project.consolidate_footage', function () {
    var removed = app.project.consolidateFootage();
    return { removed: removed, numItems: app.project.numItems };
});
