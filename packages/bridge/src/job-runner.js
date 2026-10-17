var AEMCP_HINTS = {
    AE_NOT_RUNNING: 'Launch After Effects, then retry.',
    BRIDGE_NOT_LOADED: 'Restart After Effects so the bridge loads, then retry.',
    UNKNOWN_TOOL: 'Call ae_catalog to list the operations.',
    INVALID_MESSAGE: 'Client and server protocol differ; restart the client.',
    INVALID_ARGS: "Call ae_describe for the operation's schema.",
    UNSAVED_PROJECT: 'Save the project once (File > Save), then retry.',
    SCRIPT_ERROR: 'See Window > Console in After Effects.',
    TIMEOUT: 'The job passed its deadline and was cancelled.'
};

function aemcpErrorIssue(code, message) {
    return { code: code, message: message, hint: AEMCP_HINTS[code] };
}

function aemcpFileName(path) {
    var slash = path.lastIndexOf('/');
    var name = slash >= 0 ? path.slice(slash + 1) : path;
    if (name.slice(name.length - 5) === '.json') {
        name = name.slice(0, name.length - 5);
    }
    return name;
}

var AEMCP_BUSY = false;

function aemcpBusy() {
    return AEMCP_BUSY;
}

function aemcpCallHandler(handler, args) {
    var value;
    try {
        value = handler(args);
    } catch (err) {
        if (err && err.aemcpIssue) {
            return { ok: false, issue: err.aemcpIssue };
        }
        return { ok: false, issue: aemcpErrorIssue('SCRIPT_ERROR', String(err)) };
    }
    if (value === undefined) {
        value = null;
    }
    // A handler that reports {success:false, error} failed: send it as an error,
    // not as an ok result, so ae_do flags it and batch.run stops there (#181).
    if (value !== null && typeof value === 'object' && value.success === false) {
        return {
            ok: false,
            issue: aemcpErrorIssue('INVALID_ARGS', typeof value.error === 'string' ? value.error : 'operation failed')
        };
    }
    return { ok: true, value: value };
}

function aemcpAbort(issue) {
    var err = new Error(issue.message);
    err.aemcpIssue = issue;
    throw err;
}

function aemcpRunHandler(tool, args) {
    var handler = AEMCP.HANDLERS[tool];
    if (!handler) {
        return { ok: false, issue: aemcpErrorIssue('UNKNOWN_TOOL', 'no handler for tool ' + tool) };
    }
    return aemcpCallHandler(handler, args);
}

// Ops batch.run refuses: the save and open ops leave nothing in AE's undo history,
// so undoing the batch would revert the user's own last edit instead (#202).
var AEMCP_NOT_IN_BATCH = { 'project.save': true, 'project.open': true, 'project.new': true, 'project.increment_save': true };

// Errors After Effects reported while a job ran (app.onError). With dialogs suppressed
// they would otherwise be modal "script error" dialogs that block the bridge; the job
// returns their text instead.
var AEMCP_AE_ERRORS = [];

function aemcpOnAeError(message, severity) {
    AEMCP_AE_ERRORS.push(String(message) + (severity ? ' [' + severity + ']' : ''));
}

// Ref: https://ae-scripting.docsforadobe.dev/general/application/#appbeginsuppressdialogs
// Ref: https://ae-scripting.docsforadobe.dev/general/application/#appendsuppressdialogs
// Ref: https://ae-scripting.docsforadobe.dev/general/application/#apponerror
function aemcpReportAeErrors(outcome, errors) {
    if (errors.length === 0) {
        return outcome;
    }
    var text = errors.join('; ');
    if (!outcome.ok) {
        outcome.issue.message += ' (After Effects: ' + text + ')';
        if (!outcome.issue.details) {
            outcome.issue.details = {};
        }
        outcome.issue.details.aeErrors = errors;
    } else if (outcome.value !== null && typeof outcome.value === 'object' && !(outcome.value instanceof Array)) {
        outcome.value.aeErrors = errors;
    }
    return outcome;
}

function aemcpInvoke(tool, args, deadline) {
    if (typeof deadline === 'number' && new Date().getTime() >= deadline) {
        return { ok: false, issue: aemcpErrorIssue('TIMEOUT', 'job deadline exceeded') };
    }
    var handler = AEMCP.HANDLERS[tool];
    if (!handler) {
        return { ok: false, issue: aemcpErrorIssue('UNKNOWN_TOOL', 'no handler for tool ' + tool) };
    }
    app.beginUndoGroup('Claude: ' + tool);
    AEMCP_BUSY = true;
    AEMCP_AE_ERRORS = [];
    var previousOnError = app.onError;
    app.onError = aemcpOnAeError;
    app.beginSuppressDialogs();
    var outcome;
    try {
        outcome = aemcpCallHandler(handler, args);
    } finally {
        app.endSuppressDialogs(false);
        app.onError = previousOnError;
        app.endUndoGroup();
        AEMCP_BUSY = false;
    }
    outcome = aemcpReportAeErrors(outcome, AEMCP_AE_ERRORS);
    // A failed batch is never undone by script: any scripted Edit > Undo makes AE
    // raise a modal "Undo group mismatch" that blocks every later job (ADR-0009).
    // The issue keeps `rollback: true`; the server tells the user to press Cmd+Z.
    return outcome;
}

function aemcpProcessJob(jobPath) {
    var raw = aemcpReadFile(jobPath);
    var job = null;
    if (raw !== null) {
        try {
            job = JSON.parse(raw);
        } catch (err) {
            job = null;
        }
    }
    var result;
    if (job === null || job === undefined) {
        result = { ok: false, issue: aemcpErrorIssue('INVALID_MESSAGE', 'job is not valid JSON') };
    } else if (job.protocolVersion !== 1) {
        result = { ok: false, issue: aemcpErrorIssue('INVALID_MESSAGE', 'unsupported protocol version') };
    } else if (typeof job.tool !== 'string' || job.tool.length === 0) {
        result = { ok: false, issue: aemcpErrorIssue('INVALID_MESSAGE', 'job.tool must be a non-empty string') };
    } else if (typeof job.id !== 'string' || job.id.length === 0) {
        result = { ok: false, issue: aemcpErrorIssue('INVALID_MESSAGE', 'job.id must be a non-empty string') };
    } else if (typeof job.deadline !== 'number') {
        result = { ok: false, issue: aemcpErrorIssue('INVALID_MESSAGE', 'job.deadline must be a number') };
    } else {
        result = aemcpInvoke(job.tool, job.args, job.deadline);
    }
    var id = job !== null && job !== undefined && typeof job.id === 'string' ? job.id : aemcpFileName(jobPath);
    var output;
    if (result.ok) {
        output = { protocolVersion: 1, ok: true, result: result.value };
    } else {
        output = { protocolVersion: 1, ok: false, error: result.issue };
    }
    aemcpWriteFile(aemcpQueueRoot() + '/bridge/outbox/' + id + '.json', JSON.stringify(output));
    aemcpRemoveFile(jobPath);
    return output;
}

function aemcpPollInbox(root) {
    var listing = new Folder(root + '/bridge/inbox').getFiles('*.json');
    if (listing.length === 0) {
        AEMCP_BUSY = false;
        return;
    }
    AEMCP_BUSY = true;
    aemcpProcessJob(listing[0].fsName);
    var rest = new Folder(root + '/bridge/inbox').getFiles('*.json');
    if (rest.length === 0) {
        AEMCP_BUSY = false;
    } else {
        AEMCP_BUSY = true;
    }
}

function aemcpRegister(tool, fn) {
    if (typeof tool !== 'string' || tool.length === 0) {
        throw new Error('AEMCP.register: tool must be a non-empty string');
    }
    if (typeof fn !== 'function') {
        throw new Error('AEMCP.register: handler for ' + tool + ' must be a function');
    }
    if (AEMCP.HANDLERS[tool]) {
        throw new Error('AEMCP.register: tool already registered: ' + tool);
    }
    AEMCP.HANDLERS[tool] = fn;
}

function aemcpCapabilities() {
    var names = Object.keys(AEMCP.HANDLERS);
    names.sort();
    return names;
}

var AEMCP = {};
// $.evalFile evaluates in the caller's local scope, so export through the global object.
$.global.AEMCP = AEMCP;
AEMCP.HANDLERS = {};
AEMCP.processJob = function (jobPath) {
    return aemcpProcessJob(jobPath);
};
AEMCP.invoke = function (tool, args, deadline) {
    return aemcpInvoke(tool, args, deadline);
};
AEMCP.poll = function (root) {
    aemcpPollInbox(root);
};
AEMCP.register = function (tool, fn) {
    return aemcpRegister(tool, fn);
};
AEMCP.capabilities = function () {
    return aemcpCapabilities();
};
AEMCP.busy = function () {
    return aemcpBusy();
};

// A step argument that is exactly "$<step>" plus an optional path, such as
// "$0.index" or "$2.layers[1]", reads a field of an earlier step result (#229).
var AEMCP_REF = /^\$(\d+)((?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*)$/;

// Returns a message when a reference in value names the current or a later step.
function aemcpCheckRefs(value, step, op) {
    var m, key, msg;
    if (typeof value === 'string') {
        m = AEMCP_REF.exec(value);
        if (m && parseInt(m[1], 10) >= step) {
            return 'ops[' + step + '] (' + op + '): reference ' + value + ' must name an earlier step (0 to ' + (step - 1) + ')';
        }
        return null;
    }
    if (value === null || typeof value !== 'object') return null;
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            msg = aemcpCheckRefs(value[key], step, op);
            if (msg !== null) return msg;
        }
    }
    return null;
}

// Replaces each reference with the field it names in results. Returns
// {ok: true, value: copy} or {ok: false, issue} naming the step and reference.
function aemcpResolveRefs(value, results, step, op) {
    var m, out, key, i, resolved;
    if (typeof value === 'string') {
        m = AEMCP_REF.exec(value);
        if (!m) return { ok: true, value: value };
        resolved = aemcpReadRefPath(results[parseInt(m[1], 10)], m[2]);
        if (!resolved.ok) {
            return { ok: false, issue: aemcpErrorIssue('INVALID_ARGS', 'ops[' + step + '] (' + op + '): reference ' + value + ' does not resolve to a field of its step result') };
        }
        return { ok: true, value: resolved.value };
    }
    if (value === null || typeof value !== 'object') return { ok: true, value: value };
    if (Object.prototype.toString.call(value) === '[object Array]') {
        out = [];
        for (i = 0; i < value.length; i++) {
            resolved = aemcpResolveRefs(value[i], results, step, op);
            if (!resolved.ok) return resolved;
            out.push(resolved.value);
        }
        return { ok: true, value: out };
    }
    out = {};
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            resolved = aemcpResolveRefs(value[key], results, step, op);
            if (!resolved.ok) return resolved;
            out[key] = resolved.value;
        }
    }
    return { ok: true, value: out };
}

// Walks a path such as ".layers[1].name" from root. Fails on any missing field.
function aemcpReadRefPath(root, path) {
    var value = root;
    var pos = 0;
    var end, key;
    while (pos < path.length) {
        if (path.charAt(pos) === '.') {
            end = pos + 1;
            while (end < path.length && path.charAt(end) !== '.' && path.charAt(end) !== '[') end++;
            key = path.slice(pos + 1, end);
        } else {
            end = path.indexOf(']', pos);
            key = path.slice(pos + 1, end);
            end = end + 1;
        }
        if (value === null || value === undefined || typeof value !== 'object' || value[key] === undefined) {
            return { ok: false };
        }
        value = value[key];
        pos = end;
    }
    if (value === undefined) return { ok: false };
    return { ok: true, value: value };
}

// batch.run: one undo group for many sub-ops. aemcpInvoke already opened the
// group for 'batch.run'; each sub-op runs via aemcpRunHandler (no nested group).
// When a step fails after a mutating one succeeded (args.mutating, set by the
// server) and args.atomic is not false, the issue is flagged `rollback` and
// aemcpInvoke undoes the batch after ending its group (ADR-0008).
AEMCP.register('batch.run', function (args) {
    var ops = args && args.ops ? args.ops : [];
    var results = [];
    var changed = false;
    var i, sub, outcome, msg, resolved;
    // Check every reference before any step runs, so a bad one changes nothing.
    for (i = 0; i < ops.length; i++) {
        if (ops[i] && typeof ops[i].op === 'string') {
            msg = aemcpCheckRefs(ops[i].args, i, ops[i].op);
            if (msg !== null) aemcpAbort(aemcpErrorIssue('INVALID_ARGS', msg));
        }
    }
    for (i = 0; i < ops.length; i++) {
        sub = ops[i];
        if (!sub || typeof sub.op !== 'string' || sub.op.length === 0) {
            aemcpAbort(aemcpErrorIssue('INVALID_ARGS', 'ops[' + i + '].op must be a non-empty string'));
        }
        if (AEMCP_NOT_IN_BATCH[sub.op]) {
            aemcpAbort(aemcpErrorIssue('INVALID_ARGS', 'ops[' + i + '] (' + sub.op + ') cannot run inside batch.run'));
        }
        resolved = aemcpResolveRefs(sub.args, results, i, sub.op);
        outcome = resolved.ok ? aemcpRunHandler(sub.op, resolved.value) : { ok: false, issue: resolved.issue };
        if (!outcome.ok) {
            if (args.atomic !== false && changed) {
                outcome.issue.message = 'batch rolled back after ops[' + i + '] (' + sub.op + ') failed: ' + outcome.issue.message;
                outcome.issue.rollback = true;
            }
            aemcpAbort(outcome.issue);
        }
        if (args.mutating && args.mutating[i] === true) {
            changed = true;
        }
        results.push(outcome.value);
    }
    return { results: results };
});