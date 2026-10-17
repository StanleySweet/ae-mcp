// project.lint (#244): one report of unused items, missing footage, expression errors and
// naming-rule violations. The handler only reads. The server applies the findings whose
// fix is marked safe, through ae_plan and ae_apply, when the caller passes fix: true.
// Ref: https://ae-scripting.docsforadobe.dev/property/property/#propertyexpressionerror
// Ref: https://ae-scripting.docsforadobe.dev/item/compitem/#compitemnumlayers

// Expression errors under one layer, walking groups the same way ae_expression_report does.
function aemcpLintExpressionErrors(group, prefix, out) {
    var i, child, path;
    for (i = 1; i <= group.numProperties; i++) {
        child = group.property(i);
        if (!child) {
            continue;
        }
        path = prefix ? prefix + '/' + child.name : child.name;
        if (aemcpIsGroup(child)) {
            aemcpLintExpressionErrors(child, path, out);
        } else if (child.expressionEnabled && child.expression && child.expressionError) {
            out.push({ property: path, error: child.expressionError });
        }
    }
    return out;
}

// The comps a lint covers: the one named by args.comp, else every comp in the project.
function aemcpLintComps(args) {
    var comps = [];
    var i, item;
    if (args && args.comp !== undefined && args.comp !== null && args.comp !== '') {
        comps.push(aemcpRequireComp(args.comp));
        return comps;
    }
    for (i = 1; i <= app.project.numItems; i++) {
        item = app.project.item(i);
        if (item instanceof CompItem) {
            comps.push(item);
        }
    }
    return comps;
}

AEMCP.register('project.lint', function (args) {
    var naming = args && args.naming ? args.naming : null;
    var nameTest = null;
    var renameFix = null;
    var findings = [];
    var i, j, k, comp, layer, errors, item, usage, fixArgs, scope;
    if (naming) {
        if (typeof naming.pattern !== 'string' || naming.pattern === '') {
            aemcpAbortArgs('naming.pattern must be a non-empty regular expression');
        }
        // Test without the global flag: a `g` regex keeps lastIndex between calls.
        var testFlags = typeof naming.flags === 'string' ? naming.flags.replace('g', '') : '';
        try {
            nameTest = new RegExp(naming.pattern, testFlags);
        } catch (err) {
            aemcpAbortArgs('invalid regular expression: ' + String(err));
        }
        if (naming.fix) {
            if (typeof naming.fix.match !== 'string' || naming.fix.match === '') {
                aemcpAbortArgs('naming.fix.match must be a non-empty string');
            }
            renameFix = naming.fix;
        }
    }

    // Project-level rules: always reported, whatever the comp scope.
    usage = AEMCP.HANDLERS['project.report_usage'](null);
    for (i = 0; i < usage.unusedItems.length; i++) {
        item = usage.unusedItems[i];
        findings.push({
            item: item.name,
            rule: 'unused-item',
            severity: 'warning',
            message: 'no composition uses this ' + item.type,
            fix: { safe: false, description: 'remove the item (destructive, left for you)' }
        });
    }
    for (i = 0; i < usage.missingFootage.length; i++) {
        item = usage.missingFootage[i];
        findings.push({
            item: item.name,
            rule: 'missing-footage',
            severity: 'error',
            message: 'source file not found' + (item.file ? ': ' + item.file : ''),
            fix: { safe: false, description: 'relink or replace the footage (left for you)' }
        });
    }

    // Comp-level rules: expression errors and naming.
    scope = aemcpLintComps(args);
    for (i = 0; i < scope.length; i++) {
        comp = scope[i];
        for (j = 1; j <= comp.numLayers; j++) {
            layer = comp.layer(j);
            errors = aemcpLintExpressionErrors(layer, '', []);
            for (k = 0; k < errors.length; k++) {
                findings.push({
                    item: comp.name + ' / ' + layer.name,
                    rule: 'expression-error',
                    severity: 'error',
                    message: errors[k].property + ': ' + errors[k].error,
                    comp: comp.name,
                    layer: j,
                    fix: { safe: false, description: 'fix the expression by hand (left for you)' }
                });
            }
            if (nameTest && !nameTest.test(layer.name)) {
                fixArgs = null;
                if (renameFix) {
                    fixArgs = {
                        comp: comp.name,
                        layers: [j],
                        match: renameFix.match,
                        replace: typeof renameFix.replace === 'string' ? renameFix.replace : '',
                        regex: renameFix.regex === true,
                        flags: typeof renameFix.flags === 'string' ? renameFix.flags : ''
                    };
                }
                findings.push({
                    item: comp.name + ' / ' + layer.name,
                    rule: 'naming',
                    severity: 'warning',
                    message: 'name does not match ' + naming.pattern,
                    comp: comp.name,
                    layer: j,
                    fix: fixArgs
                        ? { safe: true, description: 'rename with naming.fix', op: 'bulk.rename', args: fixArgs }
                        : { safe: false, description: 'rename by hand (no naming.fix given)' }
                });
            }
        }
    }

    var safe = 0;
    for (i = 0; i < findings.length; i++) {
        if (findings[i].fix && findings[i].fix.safe === true) {
            safe++;
        }
    }
    return { findings: findings, counts: { total: findings.length, safeFixes: safe } };
});
