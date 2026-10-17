# ae-mcp

After Effects for Claude — an MCP server that lets Claude Desktop see and edit the After Effects project the user has open.

Canonical spec: [`docs/BACKLOG.md`](docs/BACKLOG.md). **Section 2 of the backlog holds the rules every executing LLM must follow** (one task = one commit, test first, look up every AE API in the scripting guide, ES3 rules for `packages/bridge`, macOS only, runtime deps limited to `@modelcontextprotocol/sdk` and zod).

## Agent skills

### Issue tracker

Work is tracked as GitHub issues: one epic issue per backlog epic, one task issue per backlog task, blocked-by edges as native issue dependencies. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) plus `epic:<E0..E14>`, `gate` and `needs-human`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root (created lazily), ADRs in `docs/decisions/`. See `docs/agents/domain.md`.

Code map: `docs/agents/code-map.md` — file:line map of tool registration, bridge dispatch, registries and test harnesses. Read before exploring; update when code changes.

### Animation principles

Before proposing or editing motion in a user's project, load `docs/agents/animation-principles.md` — how to treat keyframes vs expressions, naming, parenting, easing and safety when driving AE. The server sends a short core of it as its `instructions` (`packages/server/src/instructions.ts`) and serves the full file as the resource `ae-mcp://animation-principles`, so callers get it without the source checked out.

### Delegation and release

Issue work goes to the `ae-issue-worker` agent (`.claude/agents/ae-issue-worker.md`, Haiku, one
worktree each): give it the issue numbers, their order and the exact commit subjects. Merge its
branch with the `merge-agent-branches` skill (`scripts/agents/merge-branch.sh`). Ship with the
`release` skill; reset the drive's scratch project with `scripts/test-drive/reset.jsx` first.
For a task with several mechanical, file-disjoint parts, the `literal-parallel-execution` skill
decides whether to split it across `cheap-worker` agents (fully specified leaves only).

## Documentation discipline

### Write down what you learn, before you finish

A conversation with an agent ends; the work continues with another agent. Anything
not written down is lost. Before handing off:

- **a decision was made** (by you or the engineer) → an ADR in `docs/decisions/`;
- **you found a contradiction or a trap** → a finding in `docs/findings/`;
- **you made progress** → an entry in `JOURNAL.md`;
- **the project state changed** → update `CONTEXT.md`.

`CONTEXT.md` is the only file you rewrite. Everything else is **append-only**: you do
not erase history, you add an entry that supersedes the previous one.

**When.** "Before handing off" also means: before a long session gets compacted (a summary
keeps the outline, not the details), after each round of agent branches is merged, and right
after a live test drive finds something. Do not wait for the end of the day.

**Defects become issues.** A bug or gap you notice in passing and do not fix now goes into
a GitHub issue, not only into the journal. Nobody reads old journal entries looking for work.

**Search before you write.** Look for an existing issue (`gh issue list --state all --search`),
finding or ADR (`grep -ril <word> docs/findings docs/decisions`) first. Comment on the open
issue, or add a superseding entry, instead of creating a duplicate.

**Write rules, not stories.** A finding states the trap and the rule that avoids it ("AE
26.5 hides its windows from Accessibility: dialogs cannot be read by script"), with the
evidence below it. The incident narrative belongs in the journal.

**Leave open threads visible.** End the journal entry with what is still running or
unverified (an agent branch, a drive not re-run, a step only the user can do) and the next
step for each.

### Decide vs. ask

You decide alone: naming, file split, test structure, local refactor.

You **ask** before acting: functional scope, the exposed API contract, dependency
choice, anything hard to reverse (push, opening/closing PRs and issues, rewriting
pushed history).

In an ADR, `Decider:` states who decided. An engineer's decision is not reopened
without them.

## Task execution loop (what every executing agent must do)

Backlog rule 1: never start a task whose dependencies are not merged. Merge = the task issue is **closed**.

For each task, in order:

1. **Pick the frontier.** Read `docs/BACKLOG.md`; find the next task whose blockers are all closed. Look up the task issue number: `gh issue list --state all --json number,title` and match the title `<Task ID> <commit message>`.
2. **Read the task issue** (`gh issue view <n>`) for its acceptance criteria; read the story + AC in the backlog and any referenced ADR.
3. **Test first.** Rule 5: look up every AE API in the scripting guide (https://ae-scripting.docsforadobe.dev) — never from memory.
4. **Implement**, then run `npm run check` (lint, typecheck, unit tests, ES3 lint, build, pack, smoke). It must be green.
5. **Commit with the exact backlog message, plus a closing footer.** The subject is the exact task commit message; the body ends with `Closes #<task issue>`. Example:
   ```
   feat(server): ae_project_info

   Closes #53
   ```
   One task = one commit. Do not batch tasks into one commit.
6. **Push** (`git push origin main`) so the `Closes #N` footer closes the task issue and unblocks its dependents.
7. **Close the parent epic when its last task closes.** After pushing, re-list the epic's task issues: `gh issue list --state all --label "epic:<ID>" --json number,title,state`. If every task (`<ID>-n …`) is `CLOSED` and the epic issue itself is still `OPEN`, close it: `gh issue close <epic> --comment "All <ID> tasks are closed."`.
8. **Check CI** after pushing: `gh run list --branch main --limit 3` (or `gh run watch`). Fix red CI with a new follow-up commit, never by force-pushing.

Other rules:

- Address AE properties, groups and effects by **match name** (`ADBE Opacity`, `ADBE Transform Group`), never by a localized display name — names follow the AE UI language (`fr_FR` shows `Opacité`, `Echelle`), match names do not. See BACKLOG §2 rule 11 and `docs/findings/2026-10-16-localized-property-names.md`.
- If you forgot a `Closes #N` footer on already-committed-but-unpushed work, rewrite those local commits (rebase/cherry-pick replay) to add it; keep a `backup/…` branch first. Never rewrite pushed history.
- Keep `docs/` current in the same commit when public behavior changes.
- No TODO without an issue ID.
- Use .tmp/ (.gitignore it if needed) instead of /tmp so you don't need permissions, flush it when needed
- Create projects and stuff in .tmp/ so you don't need permissions to access it 
