// Audio-driven animation (#242). Samples the Audio Levels of an audio layer once per
// frame and writes the loudness to a property of a target layer as keyframes.
// Convert Audio to Keyframes is not in the scripting guide, so the conversion is
// done here: each frame's loudness is read with Property.valueAtTime and written
// with Property.setValueAtTime.
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyvalueattime
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysetvalueattime
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertynearestkeyindex
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertysetinterpolationtypeatkey
// Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemframeduration
// Ref: https://ae-scripting.docsforadobe.dev/item/avitem/#avitemduration
AEMCP.register('audio.to_keyframes', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var audioIndex = args && typeof args.audioLayer === 'number' ? args.audioLayer : null;
    var targetIndex = args && typeof args.targetLayer === 'number' ? args.targetLayer : null;
    if (audioIndex === null || targetIndex === null) {
        aemcpAbortArgs('audioLayer and targetLayer are required');
    }
    var audio = comp.layer(audioIndex);
    if (!audio) {
        aemcpAbortArgs('layer not found: ' + audioIndex);
    }
    var levels = aemcpAudioLevels(audio);
    if (!levels) {
        aemcpAbortArgs('layer has no Audio Levels: ' + audioIndex);
    }
    var target = comp.layer(targetIndex);
    if (!target) {
        aemcpAbortArgs('layer not found: ' + targetIndex);
    }
    var prop = typeof args.property === 'string' ? aemcpResolveProperty(target, args.property) : null;
    if (!prop) {
        aemcpAbortArgs('property not found: ' + args.property);
    }
    if (prop.numKeys > 0) {
        aemcpAbortArgs('property ' + args.property + ' already has keyframes; remove them first');
    }
    var scale = typeof args.scale === 'number' ? args.scale : 100;
    var cuts = args.cuts || [];
    var step = comp.frameDuration;
    var count = Math.floor(comp.duration / step + 0.000001) + 1;
    var current = prop.value;
    var dims = typeof current === 'object' && current !== null ? current.length : 1;
    var i, t, sample, loudest, amplitude, value, arr, d;
    for (i = 0; i < count; i++) {
        t = i * step;
        sample = levels.valueAtTime(t, false);
        // Loudest channel in dB: -60 dB or quieter is silence, 0 dB is full volume.
        loudest = typeof sample === 'number' ? sample : Math.max(sample[0], sample[1]);
        amplitude = (loudest + 60) / 60;
        if (amplitude < 0) amplitude = 0;
        if (amplitude > 1) amplitude = 1;
        value = amplitude * scale;
        if (dims === 1) {
            prop.setValueAtTime(t, value);
        } else {
            arr = [];
            for (d = 0; d < dims; d++) {
                arr.push(value);
            }
            prop.setValueAtTime(t, arr);
        }
    }
    // Cut points (for example beat times): hold the keyframe nearest each cut so the value steps there.
    for (i = 0; i < cuts.length; i++) {
        prop.setInterpolationTypeAtKey(prop.nearestKeyIndex(cuts[i]), KeyframeInterpolationType.HOLD);
    }
    return { keys: prop.numKeys, property: prop.name, cuts: cuts.length };
});
