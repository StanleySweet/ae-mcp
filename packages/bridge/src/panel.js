// Claude for After Effects panel (E15-2, #264; settings ADR-0012). ES3 ExtendScript, built into
// dist/Claude for After Effects.jsx.
// Docks when run from the ScriptUI Panels folder (Window menu): AE passes the panel as the
// script's `this`. Run any other way, it opens a floating `palette` window instead.
// Ref: https://ae-scripting.docsforadobe.dev/introduction/overview/#running-scripts-from-the-window-menu
// Every handler is wrapped: an error here raises a modal in After Effects.

var AEMCP_PANEL_HISTORY_SHOWN = 20;
var AEMCP_PANEL_WINDOW = null;

// Ref: https://extendscript.docsforadobe.dev/file-system-access/file-object/ (read, exists)
// Single-quote a value for /bin/sh: close, escape the quote, reopen.
function aemcpPanelShellQuote(text) {
    return "'" + String(text).split("'").join("'\\''") + "'";
}

// Ref: https://ae-scripting.docsforadobe.dev/general/system/#systemcallsystem
// printf %s prints its argument verbatim (no format escapes), so the quoted text reaches pbcopy as is.
function aemcpPanelCopyCommand(text) {
    return 'printf %s ' + aemcpPanelShellQuote(text) + ' | pbcopy';
}

function aemcpPanelCopy(text) {
    try {
        // Ref: https://ae-scripting.docsforadobe.dev/general/system/#systemcallsystem
        system.callSystem(aemcpPanelCopyCommand(text));
        return true;
    } catch (error) {
        return false;
    }
}

// Ref: https://ae-scripting.docsforadobe.dev/layer/layer/ (TextLayer, ShapeLayer, CameraLayer, LightLayer, AVLayer classes)
function aemcpPanelLayerType(layer) {
    if (layer instanceof TextLayer) {
        return 'text';
    }
    if (layer instanceof ShapeLayer) {
        return 'shape';
    }
    if (layer instanceof CameraLayer) {
        return 'camera';
    }
    if (layer instanceof LightLayer) {
        return 'light';
    }
    if (layer instanceof AVLayer) {
        return 'av';
    }
    return 'layer';
}

// The text Copy for Claude puts on the clipboard: project, active comp, selected layers.
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectactiveitem
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectfile
// Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemselectedlayers
// Ref: https://ae-scripting.docsforadobe.dev/item/compitem/ (name, width, height, duration, frameRate)
function aemcpPanelContextText() {
    try {
        var lines = [];
        var project = app.project;
        var projectName = project.file ? project.file.name : 'Untitled project';
        lines.push('Project: ' + projectName);
        var comp = project.activeItem;
        if (!(comp instanceof CompItem)) {
            lines.push('Active composition: none');
            return lines.join('\n');
        }
        lines.push('Active composition: ' + comp.name + ' (' + comp.width + 'x' + comp.height + ', ' + comp.duration + ' s, ' + comp.frameRate + ' fps)');
        var selected = comp.selectedLayers;
        if (selected.length === 0) {
            lines.push('Selected layers: none');
            return lines.join('\n');
        }
        lines.push('Selected layers:');
        for (var i = 0; i < selected.length; i++) {
            var layer = selected[i];
            lines.push('  ' + layer.index + '. ' + layer.name + ' (' + aemcpPanelLayerType(layer) + ')');
        }
        return lines.join('\n');
    } catch (error) {
        return 'Could not read the project: ' + error;
    }
}

// The last 20 steps from <root>/history.jsonl, newest first. A torn line is skipped.
function aemcpPanelHistoryEntries() {
    var entries = [];
    try {
        var text = aemcpReadFile(aemcpQueueRoot() + '/history.jsonl');
        if (text === null) {
            return entries;
        }
        var lines = text.split('\n');
        for (var i = lines.length - 1; i >= 0 && entries.length < AEMCP_PANEL_HISTORY_SHOWN; i--) {
            var line = lines[i].replace(/\r$/, '');
            if (line.replace(/\s/g, '') === '') {
                continue;
            }
            try {
                entries.push(JSON.parse(line));
            } catch (parseError) {
                // a torn line from an interrupted write
            }
        }
    } catch (error) {
        // unreadable history shows as empty
    }
    return entries;
}

function aemcpPanelHistoryLine(entry) {
    var status = entry.ok ? 'ok' : 'failed';
    return entry.time + '  ' + entry.op + '  ' + status;
}

function aemcpPanelSetStatus(text) {
    try {
        AEMCP_PANEL_WINDOW.status.text = text;
    } catch (error) {
        // the window is gone
    }
}

function aemcpPanelRefresh() {
    try {
        var list = AEMCP_PANEL_WINDOW.history;
        list.removeAll();
        var entries = aemcpPanelHistoryEntries();
        for (var i = 0; i < entries.length; i++) {
            list.add('item', aemcpPanelHistoryLine(entries[i]));
        }
        aemcpPanelSetStatus(entries.length === 0 ? 'No steps yet.' : 'Last ' + entries.length + ' steps.');
    } catch (error) {
        aemcpPanelSetStatus('Could not read history.');
    }
}

function aemcpPanelCopyForClaude() {
    try {
        var text = aemcpPanelContextText();
        AEMCP_PANEL_WINDOW.context.text = text;
        if (aemcpPanelCopy(text)) {
            aemcpPanelSetStatus('Copied. Paste it into Claude.');
        } else {
            aemcpPanelSetStatus('Copy failed. Select the text below and copy it.');
        }
    } catch (error) {
        aemcpPanelSetStatus('Copy failed. Select the text below and copy it.');
    }
}

// Settings (ADR-0012): ~/.ae-mcp/settings.json, the file the server reads. The panel writes only
// the four keys below and keeps every other key as it found it.
var AEMCP_PANEL_BACKUP_MODES = ['single', 'increment', 'off'];

function aemcpPanelSettingsPath() {
    return aemcpQueueRoot() + '/settings.json';
}

// Parses settings text into an object. Missing or blank text is {}. Anything that is not a
// JSON object returns null, so Save never overwrites a file the panel cannot read.
function aemcpPanelSettingsParse(text) {
    if (text === null || /^\s*$/.test(text)) {
        return {};
    }
    var trimmed = text.replace(/^\s+|\s+$/g, '');
    if (trimmed.charAt(0) !== '{' || trimmed.charAt(trimmed.length - 1) !== '}') {
        return null;
    }
    try {
        // JSON.parse from es3-json2.js validates the text before it evaluates it.
        var value = JSON.parse(trimmed);
        if (value === null || typeof value !== 'object' || value instanceof Array) {
            return null;
        }
        return value;
    } catch (error) {
        return null;
    }
}

// The settings file as an object, or null when the file exists but is not a JSON object.
function aemcpPanelSettingsRead() {
    try {
        return aemcpPanelSettingsParse(aemcpReadFile(aemcpPanelSettingsPath()));
    } catch (error) {
        return null;
    }
}

// The four values the panel shows, with the server's defaults for missing keys.
function aemcpPanelSettingsDisplay(current) {
    var mode = current.backupMode;
    var keep = current.backupKeep;
    var isMode = false;
    for (var i = 0; i < AEMCP_PANEL_BACKUP_MODES.length; i++) {
        if (mode === AEMCP_PANEL_BACKUP_MODES[i]) {
            isMode = true;
        }
    }
    return {
        backupMode: isMode ? mode : 'single',
        backupKeep: typeof keep === 'number' && keep >= 1 ? keep : 5,
        readOnly: current.readOnly === true,
        evalEnabled: current.evalEnabled === true
    };
}

// Returns the message to show when the values cannot be saved, or null when they can.
function aemcpPanelSettingsError(values) {
    var known = false;
    for (var i = 0; i < AEMCP_PANEL_BACKUP_MODES.length; i++) {
        if (values.backupMode === AEMCP_PANEL_BACKUP_MODES[i]) {
            known = true;
        }
    }
    if (!known) {
        return 'Pick a backup mode.';
    }
    if (values.backupKeep !== Math.floor(values.backupKeep) || values.backupKeep < 1) {
        return 'Backups kept must be a whole number of 1 or more.';
    }
    return null;
}

// Copies every key of current, then sets the four panel keys. Unknown keys are kept.
function aemcpPanelSettingsMerge(current, values) {
    var merged = {};
    for (var key in current) {
        if (current.hasOwnProperty(key)) {
            merged[key] = current[key];
        }
    }
    merged.backupMode = values.backupMode;
    merged.backupKeep = values.backupKeep;
    merged.readOnly = values.readOnly;
    merged.evalEnabled = values.evalEnabled;
    return merged;
}

// JSON.stringify with a space argument, from es3-json2.js (ES3 has no JSON built in).
function aemcpPanelSettingsSerialize(settings) {
    return JSON.stringify(settings, null, 2) + '\n';
}

// Saves the four values. Returns null on success, or the message to show on failure.
function aemcpPanelSettingsSave(values) {
    var error = aemcpPanelSettingsError(values);
    if (error !== null) {
        return error;
    }
    var current = aemcpPanelSettingsRead();
    if (current === null) {
        return 'settings.json is not valid JSON. Fix or delete it, then save again.';
    }
    try {
        aemcpEnsureDirs(aemcpQueueRoot());
        if (!aemcpWriteFile(aemcpPanelSettingsPath(), aemcpPanelSettingsSerialize(aemcpPanelSettingsMerge(current, values)))) {
            return 'Could not write settings.json.';
        }
    } catch (writeError) {
        return 'Could not write settings.json.';
    }
    return null;
}

function aemcpPanelIndexOf(list, value) {
    for (var i = 0; i < list.length; i++) {
        if (list[i] === value) {
            return i;
        }
    }
    return 0;
}

// Only increment mode keeps numbered backups, so the kept count is editable only there.
function aemcpPanelSettingsSyncKeep() {
    try {
        var win = AEMCP_PANEL_WINDOW;
        win.settingsKeep.enabled = win.settingsMode.selection.text === 'increment';
    } catch (error) {
        // the window is gone
    }
}

function aemcpPanelSaveSettings() {
    try {
        var win = AEMCP_PANEL_WINDOW;
        var values = {
            backupMode: win.settingsMode.selection.text,
            backupKeep: parseInt(win.settingsKeep.text, 10),
            readOnly: win.settingsReadOnly.value === true,
            evalEnabled: win.settingsEval.value === true
        };
        var error = aemcpPanelSettingsSave(values);
        win.settingsStatus.text = error === null ? 'Saved. Applies to the next Claude operation.' : error;
    } catch (error) {
        AEMCP_PANEL_WINDOW.settingsStatus.text = 'Could not save settings.';
    }
}

// Adds the Settings section to the panel: backup mode, backups kept, two checkboxes, the
// backup folder, a note on when changes apply, and Save.
function aemcpPanelAddSettings(win) {
    var current = aemcpPanelSettingsRead();
    var values = aemcpPanelSettingsDisplay(current === null ? {} : current);
    // Ref: https://extendscript.docsforadobe.dev/user-interface-tools/window-object/ (add: type, bounds, text)
    win.add('statictext', undefined, 'Settings');
    // Ref: https://extendscript.docsforadobe.dev/user-interface-tools/control-objects/ (dropdownlist: add('item', text))
    win.settingsMode = win.add('dropdownlist', [0, 0, 200, 22]);
    for (var i = 0; i < AEMCP_PANEL_BACKUP_MODES.length; i++) {
        win.settingsMode.add('item', AEMCP_PANEL_BACKUP_MODES[i]);
    }
    // Ref: https://extendscript.docsforadobe.dev/user-interface-tools/control-objects/ (dropdownlist: selection, index or item)
    win.settingsMode.selection = aemcpPanelIndexOf(AEMCP_PANEL_BACKUP_MODES, values.backupMode);
    // Ref: https://extendscript.docsforadobe.dev/user-interface-tools/control-objects/ (edittext: text; enabled)
    win.settingsKeep = win.add('edittext', [0, 0, 60, 22], String(values.backupKeep));
    win.settingsKeep.enabled = values.backupMode === 'increment';
    // Ref: https://extendscript.docsforadobe.dev/user-interface-tools/control-objects/ (checkbox: value)
    win.settingsReadOnly = win.add('checkbox', undefined, 'Read-only: Claude cannot change the project');
    win.settingsReadOnly.value = values.readOnly;
    win.settingsEval = win.add('checkbox', undefined, 'Allow eval.run (run ExtendScript from Claude)');
    win.settingsEval.value = values.evalEnabled;
    win.add('statictext', undefined, 'Backups folder: ~/.ae-mcp/backups');
    win.add('statictext', undefined, 'Changes apply to the next Claude operation.');
    win.settingsSave = win.add('button', undefined, 'Save settings');
    // Ref: https://extendscript.docsforadobe.dev/user-interface-tools/control-objects/ (onChange event)
    win.settingsMode.onChange = function () {
        aemcpPanelSettingsSyncKeep();
    };
    win.settingsSave.onClick = function () {
        aemcpPanelSaveSettings();
    };
    win.settingsStatus = win.add('statictext', undefined, current === null ? 'settings.json is not valid JSON. Save will not overwrite it.' : '');
}

function aemcpPanelOpen(host) {
    var docked = typeof Panel !== 'undefined' && host instanceof Panel;
    // Ref: https://extendscript.docsforadobe.dev/user-interface-tools/window-object/ (Window constructor: "palette" type and creation_properties)
    var win = docked ? host : new Window('palette', 'Claude for After Effects', undefined, { resizeable: true });
    AEMCP_PANEL_WINDOW = win;
    // Ref: https://extendscript.docsforadobe.dev/user-interface-tools/window-object/ (add: type, bounds, text)
    win.add('statictext', undefined, 'Claude steps (newest first)');
    win.history = win.add('listbox', [0, 0, 360, 160]);
    var refresh = win.add('button', undefined, 'Refresh');
    // Ref: https://extendscript.docsforadobe.dev/user-interface-tools/control-objects/ (button onClick)
    refresh.onClick = function () {
        aemcpPanelRefresh();
    };
    var copy = win.add('button', undefined, 'Copy for Claude');
    copy.onClick = function () {
        aemcpPanelCopyForClaude();
    };
    win.status = win.add('statictext', undefined, 'Press Refresh to read the steps.');
    // Ref: https://extendscript.docsforadobe.dev/user-interface-tools/control-objects/ (edittext multiline)
    win.context = win.add('edittext', [0, 0, 360, 110], '', { multiline: true });
    aemcpPanelAddSettings(win);
    aemcpPanelRefresh();
    if (docked) {
        // Ref: https://extendscript.docsforadobe.dev/user-interface-tools/layoutmanager-object/ (layout(recalculate))
        win.layout.layout(true);
    } else {
        win.show();
    }
}

// Scripts in the ScriptUI Panels folder run when chosen; top-level `this` is the panel.
// Never throws: an error at load would raise a modal in After Effects.
(function (host) {
    try {
        aemcpPanelOpen(host);
    } catch (error) {
        // the panel could not open; nothing else to do
    }
})(this);
