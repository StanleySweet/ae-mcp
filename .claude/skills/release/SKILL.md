---
name: release
description: Cut an ae-mcp release (vX.Y.Z) once main is merged and CI is green - live test drive, version bump in four files, journal, tag, and release workflow. Use when the user asks for a new version or release.
---

# Release

Do not release while a known bug is open from the current round, or while CI is red.

## 1. Verify

1. `npm run check` exits 0 on `main`, and `git status` is clean, apart from untracked
   user folders.
2. `gh run list --branch main --limit 3`: the latest `ci` run is green.
3. Live test drive against the running After Effects. The drive works in its own scratch
   project and never touches the user's project.
   ```
   osascript -e 'tell application "Adobe After Effects 2026" to DoScriptFile "'$PWD'/scripts/test-drive/reset.jsx"'
   npm run test:drive > .tmp/drive.log 2>&1; grep -E "passed|✗" -A1 .tmp/drive.log
   ```
   `scripts/test-drive/reset.jsx` closes the open project without saving, but only if its path is under
   `/ae-mcp/.tmp/test-drive/`; otherwise it does nothing. Expect 0 failed. If a failure is
   a scenario bug, fix the scenario in its own commit. If it is a product bug, fix it
   first, with its own issue.
   A modal dialog in AE blocks every later job, so a cascade of "the bridge wrote no result"
   errors means a dialog is open. Ask the user to look at AE.

## 2. Bump

Patch for fixes only. Minor for new tools or operations. Set the same version in:

- `package.json` (`"version"`)
- `bundle/manifest.json` (`"version"`)
- `packages/server/src/server.ts` (`SERVER_VERSION`)
- `CONTEXT.md` (the "vX.Y.Z is released" line)

Add a `JOURNAL.md` entry under today's date (newest first):
`**`chore(release): vX.Y.Z`**: ships #...`, then short bullets: fixes, features, issues left
open with `Refs`, and the test drive's numbers.

## 3. Ship

```
npm run check
git commit -am "chore(release): vX.Y.Z" -m "Co-Authored-By: ..."
git push origin main
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
gh run watch $(gh run list --workflow release --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

A pushed tag is never moved or deleted. A bug found after the tag ships as the next patch.
