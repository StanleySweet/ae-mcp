// Motion Graphics Templates (#241). Exports a comp as a .mogrt file and reports its
// Essential Graphics controls. `controls` exposes layer properties in the panel
// before the export; their values are then set with the usual property ops.
// Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemexportasmotiongraphicstemplate
// Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemmotiongraphicstemplatename
// Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemmotiongraphicstemplatecontrollercount
// Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemgetmotiongraphicstemplatecontrollername
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertycanaddtomotiongraphicstemplate
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyaddtomotiongraphicstemplateas
AEMCP.register('mogrt.export', function (args) {
    var comp = aemcpRequireComp(aemcpCompKey(args));
    var path = args && typeof args.path === 'string' ? args.path : '';
    if (!/\.mogrt$/i.test(path)) {
        aemcpAbortArgs('path must end in .mogrt');
    }
    var overwrite = args.overwrite === true;
    if (!overwrite && new File(path).exists) {
        aemcpAbortArgs('file already exists: ' + path + ' (pass overwrite: true to replace it)');
    }
    var slash = path.lastIndexOf('/');
    var folder = slash > 0 ? path.substring(0, slash) : '/';
    // The exported file is named after the Essential Graphics name.
    var name = path.substring(slash + 1).replace(/\.mogrt$/i, '');
    if (name === '') {
        aemcpAbortArgs('path needs a file name before .mogrt');
    }
    var controls = args.controls || [];
    var i, control, layer, prop;
    for (i = 0; i < controls.length; i++) {
        control = controls[i];
        if (!control || typeof control.name !== 'string' || control.name === '') {
            aemcpAbortArgs('every control needs a name');
        }
        layer = comp.layer(control.layer);
        if (!layer) {
            aemcpAbortArgs('layer not found: ' + control.layer);
        }
        prop = aemcpResolveProperty(layer, control.property);
        if (!prop) {
            aemcpAbortArgs('property not found: ' + control.property);
        }
        if (!prop.canAddToMotionGraphicsTemplate(comp)) {
            aemcpAbortArgs('property ' + control.property + ' cannot be an Essential Graphics control');
        }
        if (!prop.addToMotionGraphicsTemplateAs(comp, control.name)) {
            aemcpAbort(aemcpErrorIssue('SCRIPT_ERROR', 'could not add control ' + control.name));
        }
    }
    // With no control, AE shows a modal instead of failing, which blocks the bridge.
    if (comp.motionGraphicsTemplateControllerCount === 0) {
        aemcpAbortArgs('the comp needs at least one Essential Graphics control: pass controls [{layer, property, name}]');
    }
    // Unsaved changes (the controls added above, a new template name, or earlier edits)
    // make AE ask "ce projet doit être enregistré" in a modal instead of exporting, so
    // stop here and let the caller save first (project.save is never done silently).
    // Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectdirty
    var renamed = comp.motionGraphicsTemplateName !== name;
    if (renamed) {
        comp.motionGraphicsTemplateName = name;
    }
    if (controls.length > 0 || renamed || app.project.dirty || !app.project.file) {
        return {
            exported: false,
            reason: 'save the project (project.save), then call mogrt.export again with the same path',
            path: folder + '/' + name + '.mogrt',
            name: name,
            controls: aemcpMogrtControls(comp)
        };
    }
    if (!comp.exportAsMotionGraphicsTemplate(overwrite, folder)) {
        aemcpAbort(aemcpErrorIssue('SCRIPT_ERROR', 'exportAsMotionGraphicsTemplate returned false'));
    }
    return {
        exported: true,
        path: folder + '/' + name + '.mogrt',
        name: name,
        controls: aemcpMogrtControls(comp)
    };
});

// The Essential Graphics controls of a comp, in panel order.
function aemcpMogrtControls(comp) {
    var out = [];
    var count = comp.motionGraphicsTemplateControllerCount;
    for (var i = 1; i <= count; i++) {
        out.push({ index: i, name: comp.getMotionGraphicsTemplateControllerName(i) });
    }
    return out;
}
