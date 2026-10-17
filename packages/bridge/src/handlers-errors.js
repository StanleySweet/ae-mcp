// INVALID_ARGS details (#237): the argument at fault, what it expected and the
// nearest known name when a property was not found. Loaded after handlers.js.

// Edit distance between two strings (ES3: plain loops, no helpers).
function aemcpEditDistance(a, b) {
    var previous = [];
    var current, i, j, cost;
    for (j = 0; j <= b.length; j++) {
        previous[j] = j;
    }
    for (i = 1; i <= a.length; i++) {
        current = [i];
        for (j = 1; j <= b.length; j++) {
            cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
            current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
        }
        previous = current;
    }
    return previous[b.length];
}

// Up to three candidates close enough to `query` to be a likely typo, nearest
// first. A candidate also matches when the query omits its 'ADBE ' prefix.
// Returns [] when nothing is close, so callers can omit `closest` (#237).
function aemcpClosestNames(candidates, query) {
    var lowerQuery = String(query).toLowerCase();
    var limit = Math.max(2, Math.floor(lowerQuery.length / 4));
    var scored = [];
    var i, name, lower, stripped, distance;
    for (i = 0; i < candidates.length; i++) {
        name = candidates[i];
        lower = name.toLowerCase();
        stripped = lower.indexOf('adbe ') === 0 ? lower.slice(5) : lower;
        distance = Math.min(aemcpEditDistance(lowerQuery, lower), aemcpEditDistance(lowerQuery, stripped));
        if (distance <= limit) {
            scored.push({ name: name, distance: distance });
        }
    }
    scored.sort(function (a, b) {
        if (a.distance !== b.distance) {
            return a.distance - b.distance;
        }
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    var names = [];
    for (i = 0; i < scored.length && i < 3; i++) {
        names.push(scored[i].name);
    }
    return names;
}

// Match names of the properties under `group`, at most `depth` levels down.
// Suggestions use match names only: display names follow the AE UI language.
function aemcpPropertyMatchNames(group, depth) {
    var names = [];
    var i, child;
    if (!aemcpIsGroup(group) || depth < 1) {
        return names;
    }
    for (i = 1; i <= group.numProperties; i++) {
        // Ref: https://ae-scripting.docsforadobe.dev/property/propertygroup/#propertygroupproperty
        child = group.property(i);
        if (!child) {
            continue;
        }
        // Ref: https://ae-scripting.docsforadobe.dev/property/propertybase/#propertybasematchname
        names.push(child.matchName);
        names = names.concat(aemcpPropertyMatchNames(child, depth - 1));
    }
    return names;
}

// Abort with INVALID_ARGS and a `details` object. Callers pass only the fields they know.
function aemcpAbortDetailed(message, details) {
    var issue = aemcpErrorIssue('INVALID_ARGS', message);
    issue.details = details;
    aemcpAbort(issue);
}

// Abort because a property path did not resolve. `message` keeps the handler's wording;
// `closest` suggests a likely match name, and is left out when none is close.
function aemcpAbortPropertyNotFound(group, path, message) {
    var details = { arg: 'property', expected: 'property match name' };
    var closest = typeof path === 'string' && path !== '' ? aemcpClosestNames(aemcpPropertyMatchNames(group, 4), path) : [];
    if (closest.length > 0) {
        details.closest = closest;
    }
    aemcpAbortDetailed(message, details);
}
