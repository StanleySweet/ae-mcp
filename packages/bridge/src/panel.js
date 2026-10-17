// ae-mcp Claude panel (E15-2, #264). ES3 ExtendScript, built into dist/ae-mcp-panel.jsx.
// A floating ScriptUI palette (the documented `palette` window). The dockable
// `this instanceof Panel` pattern is not in the JavaScript Tools Guide (ADR-0011), so
// it is not used. Every handler is wrapped: an error here raises a modal in After Effects.

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

function aemcpPanelOpen() {
    // Ref: https://extendscript.docsforadobe.dev/user-interface-tools/window-object/ (Window constructor: "palette" type and creation_properties)
    var win = new Window('palette', 'ae-mcp: Claude', undefined, { resizeable: true });
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
    aemcpPanelRefresh();
    win.show();
}

// Scripts in the ScriptUI Panels folder run once when chosen; open the palette then.
// Never throws: an error at load would raise a modal in After Effects.
(function () {
    try {
        aemcpPanelOpen();
    } catch (error) {
        // the palette could not open; nothing else to do
    }
})();
