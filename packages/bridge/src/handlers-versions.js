// Data-driven versions (#239). The server parses the CSV or JSON rows and sends
// plain values: one version per row, with `texts` (layer name -> string) and
// `footage` (layer name -> file path). Each version duplicates the template comp
// once and applies its values to the copy; the template itself is not changed.
// Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemduplicate
// Ref: https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayerreplacesource
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectimportfile
// Ref: https://ae-scripting.docsforadobe.dev/other/importoptions/
AEMCP.register('versions.generate', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var versions = args && args.versions ? args.versions : null;
    if (!versions || versions.length === 0) {
        aemcpAbortArgs('versions is required');
    }
    var dryRun = !(args && args.dryRun === false);
    var changes = [];
    var parts = [];
    var v, spec, key, texts, footage;
    // Check every version before the project changes.
    for (v = 0; v < versions.length; v++) {
        spec = versions[v];
        if (!spec || typeof spec.name !== 'string' || spec.name === '') {
            aemcpAbortArgs('every version needs a name');
        }
        texts = spec.texts || {};
        footage = spec.footage || {};
        for (key in texts) {
            if (!aemcpVersionLayer(comp, key)) {
                aemcpAbortArgs('layer not found: ' + key);
            }
            if (typeof texts[key] !== 'string') {
                aemcpAbortArgs('text for layer ' + key + ' must be a string');
            }
        }
        for (key in footage) {
            if (!aemcpVersionLayer(comp, key)) {
                aemcpAbortArgs('layer not found: ' + key);
            }
            if (typeof footage[key] !== 'string' || !new File(footage[key]).exists) {
                aemcpAbortArgs('file not found: ' + footage[key]);
            }
        }
        changes.push({ name: spec.name, texts: texts, footage: footage });
        parts.push(JSON.stringify(spec));
    }
    var fingerprint = 'versions:' + comp.name + '#' + parts.join(',');
    if (dryRun) {
        return { dryRun: true, changes: changes, fingerprint: fingerprint };
    }
    var created = [];
    var imported = {};
    var layer, prop, doc, item, copy, path;
    for (v = 0; v < changes.length; v++) {
        spec = changes[v];
        copy = comp.duplicate();
        copy.name = spec.name;
        for (key in spec.texts) {
            prop = aemcpSourceText(aemcpVersionLayer(copy, key));
            doc = prop.value;
            doc.text = spec.texts[key];
            prop.setValue(doc);
        }
        for (key in spec.footage) {
            path = spec.footage[key];
            // One import per file, shared by every version that uses it.
            if (!imported[path]) {
                imported[path] = app.project.importFile(new ImportOptions(new File(path)));
            }
            item = imported[path];
            layer = aemcpVersionLayer(copy, key);
            layer.replaceSource(item, false);
        }
        created.push({ id: copy.id, name: copy.name });
    }
    return {
        dryRun: false,
        applied: created.length,
        created: created,
        changes: changes,
        fingerprint: fingerprint
    };
});

// The layer of a comp with this exact name, or null.
function aemcpVersionLayer(comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (layer && layer.name === name) {
            return layer;
        }
    }
    return null;
}
