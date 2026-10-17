// #217: template and look library. Built from existing handlers (layer.add_solid,
// shape.add, text.add) and the same keyframe/ease code as template.lower_third.
// #225: wipe transition, styles for lower_third and title_card, tuned looks.
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

// The Effect Parade of a layer, or abort (camera and light layers have none).
function aemcpTplEffects(layer) {
    var effects = layer.property(AEMCP_MATCH.EFFECTS);
    if (!effects) aemcpAbortArgs('layer ' + layer.index + ' has no effect group');
    return effects;
}

// A parameter of an effect, by its parameter match name, or abort.
// Ref: https://ae-scripting.docsforadobe.dev/property/propertygroup/#propertygroupproperty
function aemcpTplParam(effect, matchName) {
    var param = effect.property(matchName);
    if (!param) aemcpAbortArgs('effect ' + effect.matchName + ' has no parameter ' + matchName);
    return param;
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

// template.title_card styles. default: dark, bold centred title with a scale-in.
// cinematic: black, slower fade, no scale. minimal: light background, dark
// type, quick fade.
function aemcpTitleStyle(style) {
    if (style === 'cinematic') {
        return { bg: [0, 0, 0], titleSize: 72, titleColor: [0.92, 0.92, 0.92], subSize: 30, subColor: [0.55, 0.55, 0.55], fade: 1.5, scale: false };
    }
    if (style === 'minimal') {
        return { bg: [0.96, 0.96, 0.96], titleSize: 80, titleColor: [0.1, 0.1, 0.1], subSize: 32, subColor: [0.4, 0.4, 0.4], fade: 0.4, scale: false };
    }
    return { bg: [0.05, 0.05, 0.07], titleSize: 96, titleColor: [1, 1, 1], subSize: 40, subColor: [0.8, 0.8, 0.8], fade: 0.6, scale: true };
}

// template.title_card: full-comp solid, centred title (fades in over the style's
// fade time from the in point; default and cinematic styles also scale), optional
// subtitle below. duration is the on-screen time in seconds (default 4).
// Ref: https://ae-scripting.docsforadobe.dev/layer/layercollection/#layercollectionaddsolid
AEMCP.register('template.title_card', function (args) {
    var title = args && typeof args.title === 'string' && args.title !== '' ? args.title : null;
    if (title === null) aemcpAbortArgs('title is required');
    var style = args && args.style ? args.style : 'default';
    if (style !== 'default' && style !== 'cinematic' && style !== 'minimal') {
        aemcpAbortArgs('style must be default, cinematic or minimal');
    }
    var spec = aemcpTitleStyle(style);
    var duration = aemcpSnippetNumber(args, 'duration', 4, 1);
    var compKey = args && args.comp ? args.comp : null;
    var comp = aemcpRequireComp(compKey);
    var solid = AEMCP.HANDLERS['layer.add_solid']({ comp: compKey, color: spec.bg });
    var background = aemcpTplLayerById(comp, solid.id);
    background.name = 'Title Background';
    var r = AEMCP.HANDLERS['text.add']({ comp: compKey, text: title, fontSize: spec.titleSize, fillColor: spec.titleColor, justification: 'center' });
    var titleLayer = comp.layer(r.layerIndex);
    titleLayer.outPoint = titleLayer.inPoint + duration;
    titleLayer.property(AEMCP_MATCH.TRANSFORM).property(AEMCP_MATCH.POSITION).setValue([comp.width / 2, comp.height / 2 - 20]);
    var indices = [background.index, titleLayer.index];
    var t0 = titleLayer.inPoint;
    aemcpTplFade(titleLayer, t0, 0, t0 + spec.fade, 100);
    if (spec.scale) aemcpTplScale(titleLayer, t0, [80, 80], t0 + spec.fade, [100, 100]);
    if (args.subtitle) {
        r = AEMCP.HANDLERS['text.add']({ comp: compKey, text: args.subtitle, fontSize: spec.subSize, fillColor: spec.subColor, justification: 'center' });
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
// layer's current value); zoom scales `from` up while it fades out; wipe keys
// the Linear Wipe effect's Completion on `from` from 0 to 100, revealing `to`.
// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/#layerstarttime
AEMCP.register('template.transition', function (args) {
    var comp = aemcpRequireComp(args && args.comp ? args.comp : null);
    var style = args && args.style ? args.style : null;
    if (style !== 'fade' && style !== 'push' && style !== 'zoom' && style !== 'wipe') {
        aemcpAbortArgs('style must be fade, push, zoom or wipe');
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
    } else if (style === 'wipe') {
        var wipe = aemcpAddProperty(aemcpTplEffects(from), AEMCP_MATCH.LINEAR_WIPE);
        aemcpTplEasedPair(aemcpTplParam(wipe, AEMCP_MATCH.LINEAR_WIPE_COMPLETION), start, 0, end, 100);
        set = ['from.wipe'];
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
// glitch: Turbulent Displace amount keyed 60 to 0, and an Opacity expression that
// flickers (a deterministic Math hash of the frame) until the reveal ends.
AEMCP.register('template.logo_reveal', function (args) {
    var comp = aemcpRequireComp(args && args.comp ? args.comp : null);
    var style = args && args.style ? args.style : null;
    if (style !== 'fade_scale' && style !== 'slide' && style !== 'spin' && style !== 'glitch') {
        aemcpAbortArgs('style must be fade_scale, slide, spin or glitch');
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
    } else if (style === 'glitch') {
        var displace = aemcpAddProperty(aemcpTplEffects(layer), AEMCP_MATCH.TURBULENT_DISPLACE);
        aemcpTplEasedPair(aemcpTplParam(displace, AEMCP_MATCH.TURBULENT_AMOUNT), t0, 60, t1, 0);
        // Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyexpression
        var opacity = transform.property(AEMCP_MATCH.OPACITY);
        opacity.expression = 'if (time < inPoint + 0.8) { value * (Math.abs(Math.sin(Math.floor(time * 24) * 12.9898) * 43758.5453) % 1 > 0.25 ? 1 : 0.4); } else { value; }';
        opacity.expressionEnabled = true;
        set = ['turbulent_displace.amount', 'opacity'];
    } else {
        aemcpTplEasedPair(transform.property(AEMCP_MATCH.ROTATION), t0, -90, t1, 0);
        aemcpTplFade(layer, t0, 0, t1, 100);
        set = ['rotation', 'opacity'];
    }
    return { index: layer.index, style: style, set: set };
});

// text.animate blur_in: the Gaussian Blur effect's Blurriness keyed from 30 down
// to 0 over duration seconds from the layer in point.
// Ref: https://ae-scripting.docsforadobe.dev/property/propertygroup/#propertygroupaddproperty
function aemcpTplBlurIn(layer, duration) {
    var t0 = layer.inPoint;
    var blur = aemcpAddProperty(aemcpTplEffects(layer), AEMCP_MATCH.SOFT_BLUR);
    aemcpTplEasedPair(aemcpTplParam(blur, AEMCP_MATCH.BLUR_BLURRINESS), t0, 30, t0 + duration, 0);
    return { success: true, preset: 'blur_in', property: AEMCP_MATCH.BLUR_BLURRINESS, duration: duration };
}

// lower_third geometry per style, in comp pixels. The bar is a rect of barW x barH
// at (barX, barY); title and subtitle sit at (titleX, titleY) and (titleX, subY).
// classic is the original layout.
function aemcpLowerThirdStyle(style, comp) {
    var W = comp.width;
    var H = comp.height;
    var x = W * 0.08;
    var y = H * 0.8;
    if (style === 'modern') {
        return { barX: x - 40, barY: y - 90, barW: W * 0.5, barH: 140, color: [0, 0.45, 0.9], titleX: x, titleY: y - 20, subY: y + 30, titleSize: 56, subSize: 30, titleColor: [1, 1, 1], subColor: [0.9, 0.9, 0.9] };
    }
    if (style === 'minimal') {
        return { barX: x, barY: y - 40, barW: W * 0.2, barH: 4, color: [1, 1, 1], titleX: x, titleY: y - 10, subY: y + 25, titleSize: 40, subSize: 24, titleColor: [1, 1, 1], subColor: [0.7, 0.7, 0.7] };
    }
    if (style === 'news') {
        return { barX: 0, barY: y - 50, barW: W, barH: 130, color: [0.75, 0.05, 0.1], titleX: W * 0.03, titleY: y - 10, subY: y + 35, titleSize: 46, subSize: 28, titleColor: [1, 1, 1], subColor: [1, 1, 1] };
    }
    return { barX: x - 20, barY: y - 80, barW: W * 0.4, barH: 110, color: [0.1, 0.1, 0.1], titleX: x, titleY: y - 10, subY: y + 25, titleSize: 48, subSize: 28, titleColor: [1, 1, 1], subColor: [0.8, 0.8, 0.8] };
}

// The effects each look adds, with the parameters it sets. Values are starting
// points chosen by eye; they have not been checked on live AE. Parameter match
// names come from the probe in docs/findings/2026-10-17-effect-param-matchnames.md.
// Ref: https://ae-scripting.docsforadobe.dev/matchnames/effects/firstparty/
function aemcpLookSpec(look) {
    var M = AEMCP_MATCH;
    if (look === 'glow') return [[M.GLOW, [[M.GLOW_THRESHOLD, 60], [M.GLOW_RADIUS, 25], [M.GLOW_INTENSITY, 1.5]]]];
    if (look === 'vignette') return [[M.VIGNETTE, [[M.VIGNETTE_AMOUNT, 0.6]]]];
    if (look === 'film_grain') return [[M.FILM_GRAIN, [[M.NOISE_AMOUNT, 12]]]];
    if (look === 'soft_blur') return [[M.SOFT_BLUR, [[M.BLUR_BLURRINESS, 6]]]];
    if (look === 'drop_shadow') return [[M.DROP_SHADOW, [[M.SHADOW_OPACITY, 60], [M.SHADOW_DISTANCE, 8], [M.SHADOW_SOFTNESS, 12]]]];
    if (look === 'neon') return [[M.GLOW, [[M.GLOW_THRESHOLD, 40], [M.GLOW_RADIUS, 60], [M.GLOW_INTENSITY, 3]]]];
    if (look === 'vhs') return [[M.FILM_GRAIN, [[M.NOISE_AMOUNT, 12]]], [M.TURBULENT_DISPLACE, [[M.TURBULENT_AMOUNT, 2]]]];
    if (look === 'chromatic') return [[M.TURBULENT_DISPLACE, [[M.TURBULENT_AMOUNT, 5]]]];
    if (look === 'duotone') return [[M.TINT, [[M.TINT_DARK, [0.1, 0.05, 0.25]], [M.TINT_LIGHT, [1, 0.8, 0.4]], [M.TINT_AMOUNT, 100]]]];
    if (look === 'cinematic') return [[M.BRIGHTNESS_CONTRAST, [[M.BC_BRIGHTNESS, -5], [M.BC_CONTRAST, 15]]], [M.VIGNETTE, [[M.VIGNETTE_AMOUNT, 0.6]]]];
    return null;
}

// look.apply: adds the look's effects in order and sets their parameters at the
// comp time (aemcpSetValue, so a keyed parameter gets a key).
AEMCP.register('look.apply', function (args) {
    var comp = aemcpRequireComp(args && args.comp ? args.comp : null);
    var layer = aemcpTplLayerAt(comp, args.index);
    var look = args && args.look ? args.look : null;
    var spec = aemcpLookSpec(look);
    if (!spec) {
        aemcpAbortArgs('look must be glow, vignette, film_grain, soft_blur, drop_shadow, neon, vhs, chromatic, duotone or cinematic');
    }
    var effects = aemcpTplEffects(layer);
    var names = [];
    var i, j, effect, params;
    for (i = 0; i < spec.length; i++) {
        effect = aemcpAddProperty(effects, spec[i][0]);
        names.push(spec[i][0]);
        params = spec[i][1];
        for (j = 0; j < params.length; j++) {
            aemcpSetValue(aemcpTplParam(effect, params[j][0]), params[j][1], comp.time);
        }
    }
    return { index: layer.index, look: look, effect: names[0], effects: names };
});
