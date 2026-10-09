# Contributing

- One task = one commit. Never combine tasks.
- Before coding, read the task, its story's acceptance criteria (AC) and any referenced ADR.
- Write the test first when the behavior is testable.
- Use the commit message given in the task, exactly (Conventional Commits).
- Never use an After Effects API from memory. Look it up in the AE scripting guide.
- Bridge code (`packages/bridge`) must follow ES3 rules (see `docs/BACKLOG.md` §2).
- Runtime dependencies are limited to `@modelcontextprotocol/sdk` and zod.
- Update docs in the same commit if public behavior changes.
- Run `npm run check` before committing.

See `AGENTS.md` and `docs/BACKLOG.md` for full rules.
