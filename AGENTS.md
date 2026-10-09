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
