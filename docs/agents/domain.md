# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the domain glossary (loader, payload, transport, job, plan, destructive guard, …).
- **`docs/decisions/`**: ADRs (`0001-transport.md`, `0002-third-party-tools.md`, …). Read the ADRs that touch the area you're about to work in.
- **`docs/BACKLOG.md`**: the canonical product spec; section 2 holds the rules for executing LLMs, section 8 the operation catalog, section 9 the manual checklist.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── docs/
│   ├── BACKLOG.md
│   ├── decisions/
│   │   ├── 0001-transport.md
│   │   └── 0002-third-party-tools.md
│   ├── QUESTIONS.md
│   └── agents/
└── packages/
```

ADR numbering is fixed by the backlog: `0001` is the transport decision, `0002` the third-party tools decision. New ADRs continue from `0003`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (transport), but worth reopening because…_
