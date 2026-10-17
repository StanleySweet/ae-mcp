// #217: template and look library. Built from existing handlers (layer.add_solid,
// shape.add, text.add) and the same keyframe/ease code as template.lower_third.
// ES3 only: this file is concatenated into the ExtendScript payload.

// The layer at a comp index, or abort. A non-number index is a bad argument.
function aemcpTplLayerAt(comp, index) {
    if (typeof index !== 'number') aemcpAbortArgs('index is required (layer index)');
    var layer = comp.layer(index);
    if (!layer) aemcpAbortArgs('layer not found: ' + index);
    return layer;
}

// The Transform group of a layer, or abort (camera and light layers have none).
function aemcpTplTransform(layer) {
    var transform = layer.property(AEMCP_MATCH.TRANSFORM);
    if (!transform) aemcpAbortArgs('layer ' + layer.index + ' has no transform group');
    return transform;
}

// The layer that layer.add_solid just made, found by its layer id (it returns
// no index).
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerid
function aemcpTplLayerById(comp, id) {
    var i;
    for (i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).id === id) return comp.layer(i);
    }
    aemcpAbortArgs('layer not found: id ' + id);
}

// Two keys on one property, Easy Ease on both (influence 66.67, speed 0).
// aemcpEaseArray sizes the eases by the property's value type.
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysetvalueattime
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertynearestkeyindex
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysettemporaleaseatkey
// Ref: https://ae-scripting.docsforadobe.dev/other/keyframeease/
function aemcpTplEasedPair(prop, t0, a, t1, b) {
    prop.setValueAtTime(t0, a);
    prop.setValueAtTime(t1, b);
    var ease = aemcpEaseArray(prop, 0, 66.67);
    prop.setTemporalEaseAtKey(prop.nearestKeyIndex(t0), ease, ease);
    prop.setTemporalEaseAtKey(prop.nearestKeyIndex(t1), ease, ease);
}

// Opacity and Scale of a layer as value pairs over [t0, t1].
function aemcpTplFade(layer, t0, from, t1, to) {
    aemcpTplEasedPair(aemcpTplTransform(layer).property(AEMCP_MATCH.OPACITY), t0, from, t1, to);
}

function aemcpTplScale(layer, t0, from, t1, to) {
    aemcpTplEasedPair(aemcpTplTransform(layer).property(AEMCP_MATCH.SCALE), t0, from, t1, to);
}

// template.title_card: dark full-comp solid, centred title (fades and scales in
// over 0.6 s from the in point), optional subtitle below. duration is the
// on-screen time in seconds (default 4).
// Ref: https://ae-scripting.docsforadobe.dev/layer/layercollection/#layercollectionaddsolid
AEMCP.register('template.title_card', function (args) {
    var title = args && typeof args.title === 'string' && args.title !== '' ? args.title : null;
    if (title === null) aemcpAbortArgs('title is required');
    var duration = aemcpSnippetNumber(args, 'duration', 4, 1);
    var compKey = args && args.comp ? args.comp : null;
    var comp = aemcpRequireComp(compKey);
    var solid = AEMCP.HANDLERS['layer.add_solid']({ comp: compKey, color: [0.05, 0.05, 0.07] });
    var background = aemcpTplLayerById(comp, solid.id);
    background.name = 'Title Background';
    var r = AEMCP.HANDLERS['text.add']({ comp: compKey, text: title, fontSize: 96, fillColor: [1, 1, 1], justification: 'center' });
    var titleLayer = comp.layer(r.layerIndex);
    titleLayer.outPoint = titleLayer.inPoint + duration;
    titleLayer.property(AEMCP_MATCH.TRANSFORM).property(AEMCP_MATCH.POSITION).setValue([comp.width / 2, comp.height / 2 - 20]);
    var indices = [background.index, titleLayer.index];
    var t0 = titleLayer.inPoint;
    aemcpTplFade(titleLayer, t0, 0, t0 + 0.6, 100);
    aemcpTplScale(titleLayer, t0, [80, 80], t0 + 0.6, [100, 100]);
    if (args.subtitle) {
        r = AEMCP.HANDLERS['text.add']({ comp: compKey, text: args.subtitle, fontSize: 40, fillColor: [0.8, 0.8, 0.8], justification: 'center' });
        var subLayer = comp.layer(r.layerIndex);
        subLayer.outPoint = subLayer.inPoint + duration;
        subLayer.property(AEMCP_MATCH.TRANSFORM).property(AEMCP_MATCH.POSITION).setValue([comp.width / 2, comp.height / 2 + 50]);
        indices.push(subLayer.index);
    }
    return { layers: indices };
});

// template.transition: `to` starts at `from`'s out point minus duration, so the
// two overlap for duration seconds. Fade crossfades Opacity; push moves `from`
// out to the left while `to` comes in from the right (Position, from each
// layer's current value); zoom scales `from` up while it fades out.
// Wipe is not offered: the guide lists the Linear Wipe effect but not its
// Transition Completion property name.
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerstarttime
AEMCP.register('template.transition', function (args) {
    var comp = aemcpRequireComp(args && args.comp ? args.comp : null);
    var style = args && args.style ? args.style : null;
    if (style !== 'fade' && style !== 'push' && style !== 'zoom') {
        aemcpAbortArgs('style must be fade, push or zoom');
    }
    var duration = aemcpSnippetNumber(args, 'duration', 1, 0.001);
    var from = aemcpTplLayerAt(comp, args.from);
    var to = aemcpTplLayerAt(comp, args.to);
    if (from.index === to.index) aemcpAbortArgs('from and to must be different layers');
    if (duration > from.outPoint - from.inPoint) aemcpAbortArgs('duration is longer than the from layer');
    var start = from.outPoint - duration;
    var end = from.outPoint;
    var set = [];
    to.startTime = to.startTime + (start - to.inPoint);
    if (style === 'fade') {
        aemcpTplFade(from, start, 100, end, 0);
        aemcpTplFade(to, start, 0, end, 100);
        set = ['from.opacity', 'to.opacity'];
    } else if (style === 'push') {
        var fromPos = aemcpTplTransform(from).property(AEMCP_MATCH.POSITION).value;
        var toPos = aemcpTplTransform(to).property(AEMCP_MATCH.POSITION).value;
        aemcpTplEasedPair(aemcpTplTransform(from).property(AEMCP_MATCH.POSITION), start, fromPos, end, [fromPos[0] - comp.width, fromPos[1]]);
        aemcpTplEasedPair(aemcpTplTransform(to).property(AEMCP_MATCH.POSITION), start, [toPos[0] + comp.width, toPos[1]], end, toPos);
        set = ['from.position', 'to.position'];
    } else {
        var fromScale = aemcpTplTransform(from).property(AEMCP_MATCH.SCALE).value;
        var fromOpacity = aemcpTplTransform(from).property(AEMCP_MATCH.OPACITY).value;
        aemcpTplScale(from, start, fromScale, end, [fromScale[0] * 1.2, fromScale[1] * 1.2]);
        aemcpTplFade(from, start, fromOpacity, end, 0);
        set = ['from.scale', 'from.opacity'];
    }
    return { style: style, from: from.index, to: to.index, start: start, duration: duration, set: set };
});

// template.logo_reveal: one layer animates in over 0.8 s from its in point.
// fade_scale: Opacity 0 to 100 and Scale 80 to 100. slide: Position starts 200 px
// below its resting place. spin: Rotation -90 to 0 with Opacity 0 to 100.
AEMCP.register('template.logo_reveal', function (args) {
    var comp = aemcpRequireComp(args && args.comp ? args.comp : null);
    var style = args && args.style ? args.style : null;
    if (style !== 'fade_scale' && style !== 'slide' && style !== 'spin') {
        aemcpAbortArgs('style must be fade_scale, slide or spin');
    }
    var layer = aemcpTplLayerAt(comp, args.index);
    var t0 = layer.inPoint;
    var t1 = t0 + 0.8;
    var transform = aemcpTplTransform(layer);
    var set = [];
    if (style === 'fade_scale') {
        aemcpTplFade(layer, t0, 0, t1, 100);
        aemcpTplScale(layer, t0, [80, 80], t1, [100, 100]);
        set = ['opacity', 'scale'];
    } else if (style === 'slide') {
        var pos = transform.property(AEMCP_MATCH.POSITION);
        var rest = pos.value;
        aemcpTplEasedPair(pos, t0, [rest[0], rest[1] + 200], t1, rest);
        set = ['position'];
    } else {
        aemcpTplEasedPair(transform.property(AEMCP_MATCH.ROTATION), t0, -90, t1, 0);
        aemcpTplFade(layer, t0, 0, t1, 100);
        set = ['rotation', 'opacity'];
    }
    return { index: layer.index, style: style, set: set };
});

// The first-party effect each look adds (match names from the scripting guide's
// effects page). Parameters are left at their defaults: the guide page lists
// effect match names but no parameter match names.
// Ref: https://ae-scripting.docsforadobe.dev/matchnames/effects/firstparty/
AEMCP.register('look.apply', function (args) {
    var comp = aemcpRequireComp(args && args.comp ? args.comp : null);
    var layer = aemcpTplLayerAt(comp, args.index);
    var look = args && args.look ? args.look : null;
    var matchName;
    if (look === 'glow') matchName = AEMCP_MATCH.GLOW;
    else if (look === 'vignette') matchName = AEMCP_MATCH.VIGNETTE;
    else if (look === 'film_grain') matchName = AEMCP_MATCH.FILM_GRAIN;
    else if (look === 'soft_blur') matchName = AEMCP_MATCH.SOFT_BLUR;
    else if (look === 'drop_shadow') matchName = AEMCP_MATCH.DROP_SHADOW;
    else aemcpAbortArgs('look must be glow, vignette, film_grain, soft_blur or drop_shadow');
    var effects = layer.property(AEMCP_MATCH.EFFECTS);
    if (!effects) aemcpAbortArgs('layer ' + layer.index + ' has no effect group');
    aemcpAddProperty(effects, matchName);
    return { index: layer.index, look: look, effect: matchName };
});
