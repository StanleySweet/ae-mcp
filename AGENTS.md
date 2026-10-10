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
7. **Check CI** after pushing: `gh run list --branch main --limit 3` (or `gh run watch`). Fix red CI with a new follow-up commit, never by force-pushing.

Other rules:

- If you forgot a `Closes #N` footer on already-committed-but-unpushed work, rewrite those local commits (rebase/cherry-pick replay) to add it; keep a `backup/…` branch first. Never rewrite pushed history.
- Keep `docs/` current in the same commit when public behavior changes.
- No TODO without an issue ID.

