---
name: merge-agent-branches
description: Merge finished ae-issue-worker branches onto main one at a time, resolve the usual conflicts, keep npm run check green, and push. Use when agents report back from their worktrees.
---

# Merge agent branches

Agents commit in worktrees (`worktree-agent-<id>`) and never push. Merge each branch as its
report arrives; do not wait for all of them.

## Per branch

1. Read the agent's report: commits, deviations, unverified parts. Note every `Refs #N`
   (issue stays open) and every deviation from the issue.
2. `scripts/agents/merge-branch.sh <branch> [<commit count>]`
   - It cherry-picks the commits in order and resolves append-only conflicts itself:
     `docs/agents/code-map.md` (keep both sides) and the one-line source lists in
     `build.ts`, `match-names.test.ts`, `operations.test.ts` (union).
   - It stops on `MANUAL: <file>`. Resolve by keeping both features, never by dropping one.
     `server.ts` is the usual one: imports (union), tool descriptions (merge into one short
     line), handler bodies (combine both changes).
3. After each manual resolution: `npx eslint --fix <files>`, then `npm run check`.
   Then `scripts/agents/merge-branch.sh --continue`.
4. Typical breakages after a merge, and their fixes:
   - A tool description over 200 characters (`server.test.ts`): shorten it; details go to
     `docs/user-guide.md`.
   - A test that compared an error object exactly, now carrying `details`: use `toMatchObject`.
   - A test reading schemas from `ae_catalog`: pass `verbose: true`.
   - A destructured input arg dropped by a refactor (e.g. `toolArgs` rebuilt without `full`
     or `verify`): carry it through.
5. `npm run check` green on the merged tree, then `git push origin main`. The `Closes #N`
   footers close the issues.

## After all branches

- `git grep -n '^<<<<<<<'` must print nothing.
- `gh run list --branch main --limit 3`: CI green. Fix red CI with a new commit.
- Close each epic whose tasks are all closed (AGENTS.md step 7).
- Run the live test drive before a release (see the `release` skill).
- Remove merged worktrees: `git worktree remove .claude/worktrees/agent-<id>` and delete the
  branch, only after its commits are on `origin/main`.
