# Runbook: a new After Effects release

When Adobe ships a new major After Effects (for example 2026), walk through this list.

## 1. Confirm detection

- Install the new AE, then open AE-MCP Setup. The **After Effects found** row accepts any
  year at or above `MIN_SUPPORTED_AE_YEAR` (2025) in `packages/core/src/ae-discovery.ts`.
- Ask Claude to run `check_setup`; the `after_effects` check must be `ok`.
- If Adobe changed the app or folder name, update `AE_APP_PATTERN` / `AE_FOLDER_PATTERN` in
  `packages/core/src/ae-discovery.ts` and its tests, and `aeAppName()` where the app name is
  built.

## 2. Re-install the bridge loader

Each AE version has its own `Scripts/Startup` folder. Run Setup and click **Fix** on the
**Bridge installed** row so the loader lands in the new version, then restart AE and confirm
the `bridge_heartbeat` check goes green.

## 3. Run the manual checklist

Copy `docs/test-runs/2026-10-12.md` to a new dated file and run every row against the new AE.
Record the AE version under test in the file.

## 4. Check the scripting guide for breaking API changes

Review the After Effects scripting changelog:
<https://ae-scripting.docsforadobe.dev/introduction/changelog/>. Any changed
comp/item/layer/property/render API means updating the matching bridge handler in
`packages/bridge/src/handlers.js` and adding a bridge test.

## 5. Update the tested-versions table

Add or update the new major's row in [`tested-versions.md`](tested-versions.md).

## 6. Ship a patch

- Bump the version in `package.json` and `bundle/manifest.json`; the two must match
  (`bundle/manifest.test.ts` guards this).
- Run `npm run check`; it must be green.
- Commit, then tag and push: `git tag vX.Y.Z && git push origin main vX.Y.Z`. The `release`
  workflow builds the `.mcpb` and the Setup `.dmg`/`.zip` and publishes a GitHub Release with
  `SHA256SUMS.txt`.
