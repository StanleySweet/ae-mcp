// Animate (#260). One call sets keys on several properties of a layer, then eases each
// key from a cubic-bezier curve, so the speed follows how far the value travels.
// Keys: Property.setValueAtTime, then setInterpolationTypeAtKey(BEZIER), then
// setTemporalEaseAtKey with one KeyframeEase per dimension (one for spatial properties).
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysetvalueattime
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysetinterpolationtypeatkey
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysettemporaleaseatkey
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertynearestkeyindex
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyvalueattime
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyisspatial
// Ref: https://ae-scripting.docsforadobe.dev/other/keyframeease/

// Named cubic-bezier curves [x1, y1, x2, y2]. linear is the straight line (1/3, 1/3, 2/3, 2/3).
var AEMCP_CURVES = {
    linear: [1 / 3, 1 / 3, 2 / 3, 2 / 3],
    smooth: [0.45, 0, 0.55, 1],
    expo_in: [0.7, 0, 0.84, 0],
    expo_out: [0.16, 1, 0.3, 1],
    expo_in_out: [0.87, 0, 0.13, 1],
    back_out: [0.34, 1.56, 0.64, 1],
    snappy: [0.2, 0.9, 0.2, 1]
};

// AE accepts influence in [0.1, 100] only.
function aemcpInfluence(value) {
    if (value < 0.1) return 0.1;
    if (value > 100) return 100;
    return value;
}

// Outgoing side of a key, for a change of `delta` over `duration` seconds to the next key:
// influence x1 * 100, speed (y1 / x1) * delta / duration.
function aemcpOutSide(c, delta, duration) {
    return {
        influence: aemcpInfluence(c[0] * 100),
        speed: c[0] > 0 ? (c[1] / c[0]) * delta / duration : 0
    };
}

// Incoming side of a key, for a change of `delta` over `duration` seconds from the previous key:
// influence (1 - x2) * 100, speed ((1 - y2) / (1 - x2)) * delta / duration.
function aemcpInSide(c, delta, duration) {
    return {
        influence: aemcpInfluence((1 - c[2]) * 100),
        speed: c[2] < 1 ? ((1 - c[3]) / (1 - c[2])) * delta / duration : 0
    };
}

// Validate a curve name or [x1, y1, x2, y2] and return its four numbers.
function aemcpCurvePoints(curve) {
    var c = curve;
    if (typeof curve === 'string') {
        if (!AEMCP_CURVES.hasOwnProperty(curve)) {
            aemcpAbortArgs('unknown curve: ' + curve + ' (linear, smooth, expo_in, expo_out, expo_in_out, back_out, snappy, or [x1, y1, x2, y2])');
        }
        return AEMCP_CURVES[curve];
    }
    if (!aemcpIsArray(c) || c.length !== 4 || typeof c[0] !== 'number' || typeof c[1] !== 'number' ||
        typeof c[2] !== 'number' || typeof c[3] !== 'number') {
        aemcpAbortArgs('curve must be a curve name or [x1, y1, x2, y2] numbers');
    }
    if (!(c[0] > 0 && c[0] <= 1) || !(c[2] >= 0 && c[2] < 1)) {
        aemcpAbortArgs('curve needs 0 < x1 <= 1 and 0 <= x2 < 1');
    }
    return c;
}

// Realm-safe array test: arrays from the host and from the ExtendScript context both pass.
function aemcpIsArray(value) {
    return Object.prototype.toString.call(value) === '[object Array]';
}

function aemcpToArray(value) {
    return aemcpIsArray(value) ? value : [value];
}

// Per-dimension change from one value to the next. A spatial property takes one distance.
function aemcpValueDeltas(prop, from, to) {
    var a = aemcpToArray(from);
    var b = aemcpToArray(to);
    var i, sum = 0;
    if (prop.isSpatial) {
        for (i = 0; i < a.length; i++) sum += (b[i] - a[i]) * (b[i] - a[i]);
        return [Math.sqrt(sum)];
    }
    var out = [];
    for (i = 0; i < a.length; i++) out.push(b[i] - a[i]);
    return out;
}

function aemcpIsNumberOrNumbers(value) {
    var i;
    if (typeof value === 'number') return isFinite(value);
    if (!(aemcpIsArray(value)) || value.length === 0) return false;
    for (i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'number' || !isFinite(value[i])) return false;
    }
    return true;
}

// Check one track's keys: [time, value] pairs with strictly increasing times.
function aemcpCheckTrackKeys(name, keys) {
    var i, k;
    if (!aemcpIsArray(keys) || keys.length === 0) {
        aemcpAbortArgs('track ' + name + ' needs at least one [time, value] key');
    }
    for (i = 0; i < keys.length; i++) {
        k = keys[i];
        if (!aemcpIsArray(k) || k.length !== 2 || typeof k[0] !== 'number' || !isFinite(k[0]) || k[0] < 0) {
            aemcpAbortArgs('track ' + name + ' key ' + i + ' must be [time >= 0, value]');
        }
        if (!aemcpIsNumberOrNumbers(k[1])) {
            aemcpAbortArgs('track ' + name + ' key ' + i + ' value must be a number or an array of numbers');
        }
        if (i > 0 && !(k[0] > keys[i - 1][0])) {
            aemcpAbortArgs('track ' + name + ' key times must increase');
        }
    }
}

// Write the keys of one track and ease them. The first key's incoming side and the last
// key's outgoing side are held at speed 0 (there is no neighbour to move toward).
function aemcpAnimateTrack(prop, keys, curve) {
    var i, d, n, idx = [], o, s, dim, outDeltas, inDeltas, outDur, inDur, outEase, inEase;
    for (i = 0; i < keys.length; i++) {
        prop.setValueAtTime(keys[i][0], keys[i][1]);
    }
    for (i = 0; i < keys.length; i++) {
        idx.push(prop.nearestKeyIndex(keys[i][0]));
        prop.setInterpolationTypeAtKey(idx[i], KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    }
    // One KeyframeEase per dimension: 2 for TwoD, 3 for ThreeD, 1 for other types and spatial.
    n = aemcpEaseArray(prop, 0, 33.33).length;
    for (i = 0; i < keys.length; i++) {
        outDeltas = null;
        inDeltas = null;
        outDur = 1;
        inDur = 1;
        if (i < keys.length - 1) {
            outDeltas = aemcpValueDeltas(prop, keys[i][1], keys[i + 1][1]);
            outDur = keys[i + 1][0] - keys[i][0];
        }
        if (i > 0) {
            inDeltas = aemcpValueDeltas(prop, keys[i - 1][1], keys[i][1]);
            inDur = keys[i][0] - keys[i - 1][0];
        }
        outEase = [];
        inEase = [];
        for (d = 0; d < n; d++) {
            dim = outDeltas && outDeltas[d] !== undefined ? outDeltas[d] : 0;
            o = aemcpOutSide(curve, dim, outDur);
            outEase.push(new KeyframeEase(o.speed, o.influence));
            dim = inDeltas && inDeltas[d] !== undefined ? inDeltas[d] : 0;
            s = aemcpInSide(curve, dim, inDur);
            inEase.push(new KeyframeEase(s.speed, s.influence));
        }
        prop.setTemporalEaseAtKey(idx[i], inEase, outEase);
    }
}

// The tracks a preset writes: [{name, keys}] plus its default curve. Keys use match names.
function aemcpPresetPlan(layer, args) {
    var preset = args.preset;
    var start = aemcpAnimateNumber(args.start, 0, 'start');
    var duration = aemcpAnimateNumber(args.duration, 0.5, 'duration');
    if (start < 0 || duration <= 0) {
        aemcpAbortArgs('start must be >= 0 and duration > 0');
    }
    var end = start + duration;
    var position, scale, from, to, axis, distance, direction, offset, i;
    if (preset === 'fade_in') {
        return { curve: 'smooth', entries: [{ name: AEMCP_MATCH.OPACITY, keys: [[start, 0], [end, 100]] }] };
    }
    if (preset === 'slide_in') {
        direction = args.direction === undefined ? 'left' : args.direction;
        distance = aemcpAnimateNumber(args.distance, 200, 'distance');
        if (direction === 'left' || direction === 'right') axis = 0;
        else if (direction === 'up' || direction === 'down') axis = 1;
        else aemcpAbortArgs('direction must be left, right, up or down');
        // Enters from the left or top: the start is minus the distance on that axis.
        offset = direction === 'left' || direction === 'up' ? -distance : distance;
        position = aemcpResolveProperty(layer, AEMCP_MATCH.POSITION);
        if (!position || aemcpIsGroup(position)) {
            aemcpAbortPropertyNotFound(layer, AEMCP_MATCH.POSITION, 'Property not found: ' + AEMCP_MATCH.POSITION);
        }
        to = aemcpToArray(position.valueAtTime(end, false)).slice(0);
        from = to.slice(0);
        from[axis] = to[axis] + offset;
        return { curve: 'expo_out', entries: [{ name: AEMCP_MATCH.POSITION, keys: [[start, from], [end, to]] }] };
    }
    if (preset === 'pop') {
        scale = aemcpResolveProperty(layer, AEMCP_MATCH.SCALE);
        if (!scale || aemcpIsGroup(scale)) {
            aemcpAbortPropertyNotFound(layer, AEMCP_MATCH.SCALE, 'Property not found: ' + AEMCP_MATCH.SCALE);
        }
        to = aemcpToArray(scale.valueAtTime(end, false)).slice(0);
        from = [];
        for (i = 0; i < to.length; i++) from.push(0);
        return { curve: 'back_out', entries: [{ name: AEMCP_MATCH.SCALE, keys: [[start, from], [end, to]] }] };
    }
    aemcpAbortArgs('unknown preset: ' + preset + ' (fade_in, slide_in, pop)');
}

function aemcpAnimateNumber(value, fallback, name) {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || !isFinite(value)) aemcpAbortArgs(name + ' must be a number');
    return value;
}

// Animate a layer's properties from `tracks` ({property: [[time, value], ...]}) or from a
// motion `preset`. Every property and key is checked before the first key is written.
AEMCP.register('animate', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var layer = aemcpRequireLayer(comp, args, 1);
    var hasTracks = args && args.tracks !== undefined && args.tracks !== null;
    var hasPreset = args && args.preset !== undefined && args.preset !== null;
    if (hasTracks === hasPreset) {
        aemcpAbortArgs('pass exactly one of tracks or preset');
    }
    var entries = [];
    var plan = null;
    var curveArg;
    var name, i, prop;
    if (hasPreset) {
        plan = aemcpPresetPlan(layer, args);
        entries = plan.entries;
        curveArg = args.curve !== undefined ? args.curve : plan.curve;
    } else {
        if (typeof args.tracks !== 'object' || aemcpIsArray(args.tracks)) {
            aemcpAbortArgs('tracks must map property names to [time, value] keys');
        }
        for (name in args.tracks) {
            if (args.tracks.hasOwnProperty(name)) {
                aemcpCheckTrackKeys(name, args.tracks[name]);
                entries.push({ name: name, keys: args.tracks[name] });
            }
        }
        if (entries.length === 0) {
            aemcpAbortArgs('tracks needs at least one property');
        }
        curveArg = args.curve !== undefined ? args.curve : 'smooth';
    }
    var curve = aemcpCurvePoints(curveArg);
    var props = [];
    var total = 0;
    for (i = 0; i < entries.length; i++) {
        prop = aemcpResolveProperty(layer, entries[i].name);
        if (!prop || aemcpIsGroup(prop)) {
            aemcpAbortPropertyNotFound(layer, entries[i].name, 'Property not found: ' + entries[i].name);
        }
        props.push(prop);
        total += entries[i].keys.length;
    }
    var names = [];
    for (i = 0; i < entries.length; i++) {
        aemcpAnimateTrack(props[i], entries[i].keys, curve);
        names.push(entries[i].name);
    }
    return {
        success: true,
        layer: aemcpLayerRef(layer),
        properties: names,
        keyframes: total,
        curve: typeof curveArg === 'string' ? curveArg : 'custom'
    };
});
