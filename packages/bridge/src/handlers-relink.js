// Last path segment of a file path, for both '/' and '\' separators.
function aemcpBaseName(path) {
    var slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return slash >= 0 ? path.substring(slash + 1) : path;
}

// Relink missing footage from a folder. A missing item is matched by the file
// name of its missing path against the files under `folder` (subfolders only
// when recursive is true). A dry run (the default) only lists the matches; with
// apply: true each unique match is swapped in through footage.replace. A name
// that matches several files is reported as ambiguous and left alone.
// Ref: https://ae-scripting.docsforadobe.dev/item/avitem/#avitemfootagemissing
// Ref: https://ae-scripting.docsforadobe.dev/sources/filesource/#filesourcemissingfootagepath
// Ref: https://ae-scripting.docsforadobe.dev/item/footageitem/#footageitemreplace
AEMCP.register('footage.relink', function (args) {
    if (!args || typeof args.folder !== 'string' || args.folder === '') {
        aemcpAbortArgs('folder is required');
    }
    var source = new Folder(args.folder);
    if (!source.exists) {
        aemcpAbortArgs('folder not found: ' + args.folder);
    }
    var apply = args.apply === true;
    var files = aemcpCollectFolderFiles(source, args.recursive === true, []);
    var project = app.project;
    var matches = [], unmatched = [], ambiguous = [], relinked = [];
    var i, j, item, missingPath, name, hits, paths;
    for (i = 1; i <= project.numItems; i++) {
        item = project.item(i);
        if (!(item instanceof FootageItem) || !item.footageMissing) {
            continue;
        }
        missingPath = item.mainSource && item.mainSource.missingFootagePath ? item.mainSource.missingFootagePath : item.name;
        name = aemcpBaseName(missingPath);
        hits = [];
        for (j = 0; j < files.length; j++) {
            if (files[j].name === name) {
                hits.push(files[j]);
            }
        }
        if (hits.length === 0) {
            unmatched.push({ id: item.id, name: item.name, missingPath: missingPath });
        } else if (hits.length > 1) {
            paths = [];
            for (j = 0; j < hits.length; j++) {
                paths.push(hits[j].fsName);
            }
            ambiguous.push({ id: item.id, name: item.name, paths: paths });
        } else {
            matches.push({ id: item.id, name: item.name, path: hits[0].fsName });
        }
    }
    if (apply) {
        for (j = 0; j < matches.length; j++) {
            AEMCP.HANDLERS['footage.replace']({ item: matches[j].id, path: matches[j].path });
            relinked.push(matches[j]);
        }
    }
    return { applied: apply, matches: matches, relinked: relinked, unmatched: unmatched, ambiguous: ambiguous };
});
