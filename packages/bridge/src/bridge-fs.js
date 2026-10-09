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

function aemcpRemoveFile(path) {
    var file = new File(path);
    if (file.exists) {
        file.remove();
    }
}