# ADR-0011: ScriptUI APIs come from the JavaScript Tools Guide

Date: 2026-10-17
Status: Accepted
Authors: Claude
Decider: Claude, under Stan's instruction to build epic E15 (reopen with Stan if needed)
References: #264, BACKLOG §2 rule 5

## Context

Rule 5 says every After Effects API is looked up in the scripting guide
(https://ae-scripting.docsforadobe.dev), never written from memory. The Claude panel
(#264, E15-2) is a ScriptUI panel: `Window`, `Panel`, `ListBox`, `Button`, `EditText` and
the `this instanceof Panel` docking pattern. The After Effects scripting guide does not
document ScriptUI, so an agent following the rule stopped.

ScriptUI is shared by every Adobe app that runs ExtendScript. Adobe documents it in the
JavaScript Tools Guide, which the same docsforadobe project publishes at
https://extendscript.docsforadobe.dev (section "User interface tools").

## Decision

For ScriptUI and other ExtendScript core APIs (File, Folder, `$`, ScriptUI), the
JavaScript Tools Guide at https://extendscript.docsforadobe.dev is an accepted reference,
with the same rule: look it up first, put a `// Ref: <url#anchor>` comment above the code,
and never use what it does not document. After Effects object model APIs still come
from the After Effects scripting guide only.

## Consequences

- E15-2 can build its panel with documented ScriptUI.
- Existing File/Folder uses (for example `Folder.getFiles`, noted as undocumented in #245)
  can now cite the Tools Guide.
- The rule's purpose holds: every API is checked against Adobe's documentation.
