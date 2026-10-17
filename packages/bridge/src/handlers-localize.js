// Localization with fit-to-box (#243). Replaces each table entry (source text to
// translation) on the text layers of the listed comps through bulk.replace_text,
// then shrinks the font of every changed layer until its text fits the box the
// layer had before the replacement. The box is measured with sourceRectAtTime.
// Ref: https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayersourcerectattime
// Ref: https://ae-scripting.docsforadobe.dev/text/textdocument/#textdocumentfontsize
// Ref: https://ae-scripting.docsforadobe.dev/text/textdocument/#textdocumenttext
AEMCP.register('localize.apply', function (args) {
    var table = args && args.table ? args.table : null;
    if (!table || typeof table !== 'object') {
        aemcpAbortArgs('table is required');
    }
    var minSize = args && typeof args.minFontSize === 'number' ? args.minFontSize : 8;
    var comps = aemcpBulkComps(args);
    var key, c, i;
    var keys = [];
    for (key in table) {
        if (table.hasOwnProperty(key)) {
            keys.push(key);
        }
    }
    if (keys.length === 0) {
        aemcpAbortArgs('table needs at least one entry');
    }
    // Record every text layer's text and box before anything changes.
    var before = {};
    for (c = 0; c < comps.length; c++) {
        for (i = 1; i <= comps[c].numLayers; i++) {
            var layer = comps[c].layer(i);
            var textProp = aemcpSourceText(layer);
            if (!textProp) {
                continue;
            }
            var rect = layer.sourceRectAtTime(comps[c].time, false);
            before[comps[c].name + '#' + i] = {
                comp: comps[c],
                index: i,
                oldText: textProp.value.text,
                width: rect.width,
                height: rect.height
            };
        }
    }
    // Replacements go through bulk.replace_text, one table entry at a time.
    for (i = 0; i < keys.length; i++) {
        AEMCP.HANDLERS['bulk.replace_text']({
            comps: args.comps,
            comp: args.comp,
            find: keys[i],
            replace: table[keys[i]],
            dryRun: false
        });
    }
    var changes = [];
    var unfit = [];
    for (var id in before) {
        if (!before.hasOwnProperty(id)) {
            continue;
        }
        var entry = before[id];
        var current = aemcpSourceText(entry.comp.layer(entry.index));
        if (current.value.text === entry.oldText) {
            continue;
        }
        var fit = aemcpFitText(entry.comp, entry.index, entry.width, entry.height, minSize);
        changes.push({
            comp: entry.comp.name,
            index: entry.index,
            oldText: entry.oldText,
            newText: current.value.text,
            fontSize: fit.fontSize
        });
        if (!fit.fits) {
            unfit.push({ comp: entry.comp.name, index: entry.index, fontSize: fit.fontSize });
        }
    }
    return { changes: changes, unfit: unfit };
});

// Shrink a text layer's font one point at a time until its box is no larger than
// width x height, stopping at minSize. Returns the final size and whether it fits.
function aemcpFitText(comp, index, width, height, minSize) {
    var layer = comp.layer(index);
    var prop = aemcpSourceText(layer);
    var doc = prop.value;
    var rect = layer.sourceRectAtTime(comp.time, false);
    while (rect.width > width || rect.height > height) {
        if (doc.fontSize <= minSize) {
            return { fontSize: doc.fontSize, fits: false };
        }
        doc.fontSize = Math.max(minSize, doc.fontSize - 1);
        prop.setValue(doc);
        rect = layer.sourceRectAtTime(comp.time, false);
    }
    return { fontSize: doc.fontSize, fits: true };
}
