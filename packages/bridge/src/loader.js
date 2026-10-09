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
    var caps = [];
    if (typeof AEMCP !== 'undefined') {
        caps = AEMCP.capabilities();
    }
    var beat = {
        protocolVersion: 1,
        bridgeVersion: version,
        aeVersion: app.version,
        os: $.os,
        capabilities: caps,
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
    app.scheduleTask(function () {
        AEMCP.poll(root);
    }, 200, true);
})();