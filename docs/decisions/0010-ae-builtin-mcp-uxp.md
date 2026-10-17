# ADR-0010: Go or no-go on the After Effects built-in MCP server (UXP)

Date: 2026-10-17
Status: proposed
Authors: Claude
Decider: pending (engineer)
References: #249, docs/findings/2026-10-17-ae-builtin-mcp-uxp.md

## Context

After Effects 26.5 is reported to ship an MCP server, behind a beta flag, that UXP
extensions can add tools to. It is said to include native render and annotation
tools that ae-mcp currently provides itself (`ae_render`, `ae_render_frame`,
`ae_dialogs`).

Desk research (see the findings doc) found no Adobe documentation for the server, the
registration API or the beta flag. The decision cannot be made on evidence yet.

## Options

1. **No-go.** Keep the ExtendScript bridge and the file queue. Revisit when Adobe
   documents the feature.
2. **Go, as a spike.** Build one ae-mcp tool through the built-in server on a real
   AE 26.5 beta build, then decide. The current server's public tools stay unchanged.
3. **Go, replace.** Move render and dialog work to the built-in server. Not proposed:
   there is no evidence yet that it covers what ae-mcp does.

## Proposed

Option 2 once a human has an AE 26.5 beta build with the flag on. Until then, no
code changes.

Acceptance for the spike (from #249):
- the registration API is recorded in the findings doc, from Adobe sources only;
- one prototype tool runs through the built-in server on the beta build;
- the outcome, including any crash or dialog, is recorded in the findings doc;
- this ADR is updated to accepted (go) or rejected (no-go) with the reasons.

## Consequences

- Any UXP route is a second execution path. It must follow the same safety rules:
  no scripted undo (ADR-0009), destructive-operation guard, and match-name rules.
- If go: the bridge stays for AE versions without the flag, so two paths are kept
  for a while.

## Decision

Pending. Decider: engineer. Claude does not decide this.
