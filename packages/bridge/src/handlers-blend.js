// Layer blending mode (Screen, Add, Overlay...), needed for glow and glass looks.
// The mode is given in snake case ('screen', 'soft_light') and mapped to BlendingMode.

// Ref: https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayerblendingmode
var AEMCP_BLEND_MODES = [
    'ADD', 'ALPHA_ADD', 'CLASSIC_COLOR_BURN', 'CLASSIC_COLOR_DODGE', 'CLASSIC_DIFFERENCE', 'COLOR',
    'COLOR_BURN', 'COLOR_DODGE', 'DANCING_DISSOLVE', 'DARKEN', 'DARKER_COLOR', 'DIFFERENCE', 'DISSOLVE',
    'DIVIDE', 'EXCLUSION', 'HARD_LIGHT', 'HARD_MIX', 'HUE', 'LIGHTEN', 'LIGHTER_COLOR', 'LINEAR_BURN',
    'LINEAR_DODGE', 'LINEAR_LIGHT', 'LUMINESCENT_PREMUL', 'LUMINOSITY', 'MULTIPLY', 'NORMAL', 'OVERLAY',
    'PIN_LIGHT', 'SATURATION', 'SCREEN', 'SILHOUETE_ALPHA', 'SILHOUETTE_LUMA', 'SOFT_LIGHT',
    'STENCIL_ALPHA', 'STENCIL_LUMA', 'SUBTRACT', 'VIVID_LIGHT'
];

AEMCP.register('layer.set_blend_mode', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var layer = aemcpRequireLayer(comp, args);
    var name = args && typeof args.mode === 'string' ? args.mode.toUpperCase() : '';
    var known = false;
    var i;
    for (i = 0; i < AEMCP_BLEND_MODES.length; i++) {
        if (AEMCP_BLEND_MODES[i] === name) {
            known = true;
        }
    }
    if (!known || BlendingMode[name] === undefined) {
        aemcpAbortArgs('unknown blend mode: ' + (args ? args.mode : '') + ' (use names like screen, add, overlay, soft_light)');
    }
    if (layer.blendingMode === undefined) {
        aemcpAbortArgs('layer ' + layer.index + ' has no blending mode (camera or light)');
    }
    layer.blendingMode = BlendingMode[name];
    return { index: layer.index, name: layer.name, mode: name.toLowerCase() };
});
