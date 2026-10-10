var AEMCP_HINTS = {
    AE_NOT_RUNNING: 'Launch After Effects, then retry.',
    BRIDGE_NOT_LOADED: 'Restart After Effects so the startup loader runs, then retry.',
    UNKNOWN_TOOL: 'Call ae_catalog to list the available tools.',
    INVALID_MESSAGE: 'Client and server protocol versions differ; restart the client after upgrading.',
    INVALID_ARGS: 'Check the tool description for the expected arguments.',
    SCRIPT_ERROR: 'Open Window > Console in After Effects for the script error.',
    TIMEOUT: 'The job exceeded its deadline and was cancelled.'
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
    var outcome;
    try {
        outcome = aemcpCallHandler(handler, args);
    } finally {
        app.endUndoGroup();
        AEMCP_BUSY = false;
    }
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

// batch.run: one undo group for many sub-ops. aemcpInvoke already opened the
// group for 'batch.run'; each sub-op runs via aemcpRunHandler (no nested group).
AEMCP.register('batch.run', function (args) {
    var ops = args && args.ops ? args.ops : [];
    var results = [];
    var i, sub, outcome;
    for (i = 0; i < ops.length; i++) {
        sub = ops[i];
        if (!sub || typeof sub.op !== 'string' || sub.op.length === 0) {
            aemcpAbort(aemcpErrorIssue('INVALID_ARGS', 'ops[' + i + '].op must be a non-empty string'));
        }
        outcome = aemcpRunHandler(sub.op, sub.args);
        if (!outcome.ok) {
            aemcpAbort(outcome.issue);
        }
        results.push(outcome.value);
    }
    return { results: results };
});