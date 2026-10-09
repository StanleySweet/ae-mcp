/*
 * Transport A spike: a Scripts/Startup loader that polls an inbox.
 *
 * Copy this file into the user Scripts/Startup folder so After Effects runs it
 * on launch. It polls ~/.ae-mcp/spike/inbox for <id>.txt jobs, echoes each job
 * to ~/.ae-mcp/spike/outbox/<id>.txt and then consumes the job file.
 *
 * API: app.scheduleTask(stringToExecute, delay, repeat)
 *   https://ae-scripting.docsforadobe.dev/general/application/#appscheduletask
 * API: app.cancelTask(taskID)
 *   https://ae-scripting.docsforadobe.dev/general/application/#appcanceltask
 *
 * ExtendScript ES3: var only, no arrow functions, no template strings,
 * no native JSON or array iteration helpers.
 */
var AE_MCP_SPIKE = (function () {
  var ROOT = "~/.ae-mcp/spike";
  var INBOX = ROOT + "/inbox";
  var OUTBOX = ROOT + "/outbox";
  var POLL_MS = 200;
  var taskId = null;

  function ensureFolder(path) {
    var folder = new Folder(path);
    if (!folder.exists) {
      folder.create();
    }
    return folder;
  }

  function readText(file) {
    var text = "";
    file.encoding = "UTF-8";
    if (file.open("r")) {
      text = file.read();
      file.close();
    }
    return text;
  }

  function writeText(file, text) {
    file.encoding = "UTF-8";
    if (file.open("w")) {
      file.write(text);
      file.close();
    }
  }

  function processJob(file) {
    var body = readText(file);
    writeText(new File(OUTBOX + "/" + file.name), body);
    file.remove();
  }

  function tick() {
    try {
      ensureFolder(INBOX);
      ensureFolder(OUTBOX);
      var jobs = new Folder(INBOX).getFiles("*.txt");
      for (var i = 0; i < jobs.length; i++) {
        try {
          processJob(jobs[i]);
        } catch (jobError) {
          // leave the job in place so a later tick can retry it
        }
      }
    } catch (error) {
      // never throw out of a scheduled task
    }
  }

  function start() {
    if (taskId === null) {
      taskId = app.scheduleTask("AE_MCP_SPIKE.tick()", POLL_MS, true);
    }
  }

  function stop() {
    if (taskId !== null) {
      app.cancelTask(taskId);
      taskId = null;
    }
  }

  return { tick: tick, start: start, stop: stop };
})();

AE_MCP_SPIKE.start();
