var AEMCP_ROOT = null;

function aemcpQueueRoot() {
    if (AEMCP_ROOT === null) {
        var env = $.getenv('AE_MCP_ROOT');
        if (env && env.length > 0) {
            AEMCP_ROOT = env;
        } else {
            AEMCP_ROOT = $.getenv('HOME') + '/.ae-mcp';
        }
    }
    return AEMCP_ROOT;
}

function aemcpEnsureDirs(root) {
    var dirs = [root, root + '/bridge', root + '/bridge/inbox', root + '/bridge/outbox'];
    for (var i = 0; i < dirs.length; i++) {
        var folder = new Folder(dirs[i]);
        if (!folder.exists) {
            folder.create();
        }
    }
}

function aemcpReadFile(path) {
    var file = new File(path);
    if (!file.exists) {
        return null;
    }
    if (!file.open('r')) {
        return null;
    }
    var text = file.read();
    file.close();
    return text;
}

function aemcpWriteFile(path, text) {
    var file = new File(path);
    if (!file.open('w')) {
        return false;
    }
    file.write(text);
    file.close();
    return true;
}

function aemcpPayloadVersion(source) {
    var marker = 'AEMCP_BRIDGE_VERSION = "';
    var at = source.indexOf(marker);
    if (at < 0) {
        return null;
    }
    var start = at + marker.length;
    var end = source.indexOf('"', start);
    if (end < 0) {
        return null;
    }
    return source.slice(start, end);
}

function aemcpLoadPayload(root) {
    var path = root + '/bridge/current.jsx';
    var source = aemcpReadFile(path);
    if (source === null) {
        return null;
    }
    var version = aemcpPayloadVersion(source);
    var markerFile = root + '/bridge/.payload-version';
    var loaded = aemcpReadFile(markerFile);
    if (loaded !== version) {
        $.evalFile(path);
        aemcpWriteFile(markerFile, version);
    }
    return version;
}

function aemcpSendHeartbeat(root, version) {
    var beat = {
        protocolVersion: 1,
        bridgeVersion: version,
        aeVersion: app.version,
        os: $.os,
        capabilities: [],
        busy: false,
        transport: 'startup-loader'
    };
    aemcpWriteFile(root + '/bridge/outbox/heartbeat.json', JSON.stringify(beat));
}

function aemcpBeat(root) {
    var version = aemcpLoadPayload(root);
    if (version === null) {
        version = 'none';
    }
    aemcpSendHeartbeat(root, version);
    return version;
}

(function () {
    var root = aemcpQueueRoot();
    aemcpEnsureDirs(root);
    aemcpBeat(root);
    app.scheduleTask(function () {
        aemcpBeat(root);
    }, 30000, true);
})();