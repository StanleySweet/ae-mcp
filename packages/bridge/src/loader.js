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
    // The marker file survives restarts but AEMCP does not: always load in a fresh session.
    if (loaded !== version || typeof AEMCP === 'undefined') {
        $.evalFile(path);
        aemcpWriteFile(markerFile, version);
    }
    return version;
}

function aemcpSendHeartbeat(root, version) {
    var caps = [];
    var busy = false;
    if (typeof AEMCP !== 'undefined') {
        caps = AEMCP.capabilities();
        busy = AEMCP.busy();
    }
    var beat = {
        protocolVersion: 1,
        bridgeVersion: version,
        aeVersion: app.version,
        os: $.os,
        capabilities: caps,
        busy: busy,
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

// app.scheduleTask only accepts a string of code run in the global scope, so the
// scheduled work lives in global functions. They never throw: an error in a
// scheduled task would raise a modal dialog in After Effects.
function aemcpBeatTick() {
    try {
        aemcpBeat(aemcpQueueRoot());
    } catch (error) {
        // try again on the next beat
    }
}

function aemcpPollTick() {
    try {
        if (typeof AEMCP !== 'undefined') {
            AEMCP.poll(aemcpQueueRoot());
        }
    } catch (error) {
        // the job stays in the inbox for the next poll
    }
}

(function () {
    var root = aemcpQueueRoot();
    aemcpEnsureDirs(root);
    aemcpBeat(root);
    app.scheduleTask('aemcpBeatTick()', 30000, true);
    app.scheduleTask('aemcpPollTick()', 200, true);
})();