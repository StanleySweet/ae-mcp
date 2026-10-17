// eval.run: run ExtendScript code and return the value of its last expression.
// The server gates it (settings.evalEnabled); this file runs whatever gets through.
// ES3 only: this file is concatenated into the ExtendScript payload.

// The eval result in a JSON-safe form: null, booleans, numbers and strings as
// they are; arrays and objects when JSON.stringify accepts them; anything else
// (undefined, functions, cyclic objects) as its string form.
function aemcpEvalResult(value) {
    if (value === null) return null;
    var type = typeof value;
    if (type === 'boolean' || type === 'number' || type === 'string') return value;
    if (type === 'object') {
        try {
            JSON.stringify(value);
            return value;
        } catch (e) {
            // Not serialisable: fall through to the string form.
        }
    }
    return String(value);
}

// Runs in the job's undo group (aemcpInvoke). Exceptions are not caught here:
// aemcpCallHandler turns them into SCRIPT_ERROR with the message.
AEMCP.register('eval.run', function (args) {
    if (!args || typeof args.code !== 'string' || args.code.length === 0) {
        aemcpAbortArgs('code must be a non-empty string');
    }
    var value = eval(args.code);
    return { result: aemcpEvalResult(value) };
});
