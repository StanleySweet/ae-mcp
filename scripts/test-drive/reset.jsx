/* global app, File, $, CloseOptions */
// Run before `npm run test:drive`: closes the open project without saving, but only when it
// is the drive's own scratch project (under /ae-mcp/.tmp/test-drive/). Anything else is left
// alone. The outcome is written to .tmp/reset.txt.
// Ref: https://ae-scripting.docsforadobe.dev/general/project/#projectclose
var aemcpRepo = new File($.fileName).parent.parent.parent;
var aemcpOut = new File(aemcpRepo.fsName + '/.tmp/reset.txt');
var aemcpCur = app.project.file ? app.project.file.fsName : '';
aemcpOut.open('w');
if (aemcpCur.indexOf('/ae-mcp/.tmp/test-drive/') >= 0) {
    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    app.newProject();
    aemcpOut.write('reset from ' + aemcpCur);
} else {
    aemcpOut.write('refused: open project is ' + (aemcpCur || '(untitled)'));
}
aemcpOut.close();
