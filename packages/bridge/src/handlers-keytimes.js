// Key times for ae_render_frame atKeys (E15-5). Read-only: walks a layer's property tree
// (or every layer of the comp) and collects the time of each keyframe, without values.
// Layer markers are not keyframes and are skipped.
// Ref: https://ae-scripting.docsforadobe.dev/property/propertygroup/#propertygroupnumproperties
// Ref: https://ae-scripting.docsforadobe.dev/property/propertygroup/#propertygroupproperty
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertynumkeys
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertykeytime
// Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemnumlayers
// Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemlayer

// Appends the key times of every keyed property below `group` to `out`.
function aemcpCollectKeyTimes(group, out) {
    var i, child;
    for (i = 1; i <= group.numProperties; i++) {
        child = group.property(i);
        if (!child) {
            continue;
        }
        if (typeof child.numKeys === 'number') {
            for (var k = 1; k <= child.numKeys; k++) {
                out.push(child.keyTime(k));
            }
        } else if (typeof child.numProperties === 'number') {
            aemcpCollectKeyTimes(child, out);
        }
    }
    return out;
}

AEMCP.register('keyframe.times', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var hasLayer = args && (args.layer !== undefined && args.layer !== null || args.index !== undefined && args.index !== null);
    var layers = [];
    var times = [];
    var i;
    if (hasLayer) {
        layers.push(aemcpRequireLayer(comp, args));
    } else {
        for (i = 1; i <= comp.numLayers; i++) {
            layers.push(comp.layer(i));
        }
    }
    for (i = 0; i < layers.length; i++) {
        aemcpCollectKeyTimes(layers[i], times);
    }
    times.sort(function (a, b) { return a - b; });
    return { comp: comp.name, layers: layers.length, times: times };
});
