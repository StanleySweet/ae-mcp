---
name: literal-parallel-execution
description: Decide whether a ae-mcp task should be split across cheap-worker subagents, and if so, write their specs and integrate the results. Use when a task has several mechanical, file-disjoint parts. Not for investigation, design, or a single coupled change.
---

# Literal parallel execution (ae-mcp)

Delegation is a cost decision, not a default. Work through this in order and stop at the first
"keep it central".

## 1. Keep it central when

- The task starts with "find out whether X is documented" or "why does Y fail". Investigate
  first (ScriptUI and AE API checks, ADR lookups). A worker cannot judge a blocker.
- The parts share a file, or one part's output is another's input (for example `build.ts`
  feeding the installer copy step).
- The whole change is under about three files, or fewer than about 40 changed lines.
- It needs `npm run check` iterations to get green. Run those yourself.

## 2. Split only when all of these hold

- Each part is mechanical and its spec is complete: exact files, exact edits, exact verify
  command.
- Parts touch disjoint files. Never give two workers one file. Merge hotspots that always
  count as shared: `packages/bridge/src/build.ts`, `apps/installer/AeMcpSetup.Core/InstallLoader.cs`,
  `apps/installer/AeMcpSetup/SetupService.cs`, `docs/agents/code-map.md`, `docs/user-guide.md`,
  `packages/server/src/server.ts`, `packages/server/src/operations.ts`.
- Each part fits the cheap-worker limits: one or two files, one verify command.

Good candidates: a new C# xunit test file for an already-written class; a doc section for a
feature already built; a fixture or mock addition with a known shape.

## 3. Spec every worker with all fields

```
TASK_ID:
GOAL:
FILES_ALLOWED:
EXACT_CHANGES:
DO_NOT:
DEPENDENCIES:
ACCEPTANCE_CRITERIA:
VERIFY_COMMAND:
```

Use NONE where a field does not apply. Quote any API the change uses, with its docs URL, in
EXACT_CHANGES. If you cannot write a field, do that part yourself.

## 4. Dispatch and integrate

1. Write the numbered plan first. Mark each part central or delegated, with its files.
2. Dispatch independent delegated parts in one message, each with `subagent_type: cheap-worker`.
3. Wait for all of them. A BLOCKED worker means fix the spec or do the part yourself. A FAILED
   worker means read its error; do not retry unchanged.
4. Integrate central parts last, or in the order the plan states. Resolve conflicts yourself.
5. Run `npm run check` once, centrally. Commit under the issue's subject and footer as the
   lead asked.

## 5. Failure policy

- BLOCKED: return the missing field. Do not improvise.
- FAILED: keep the error line and the verify command. Do not retry without a corrected spec.
- DONE: check the diff against FILES_ALLOWED before accepting it.

## Reporting

Report only material failures and unresolved issues. The lead does not need each worker's
narration.
