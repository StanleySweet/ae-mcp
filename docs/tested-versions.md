# Tested After Effects versions

macOS only. ae-mcp targets **After Effects 2025 (25.x) and later**: the Setup app and the
`after_effects` check refuse an older install (`MIN_SUPPORTED_AE_YEAR` in
`packages/core/src/ae-discovery.ts`).

This table records the After Effects versions the project has actually been run against on
macOS.

| After Effects | Version | Status | Verified by |
|---|---|---|---|
| 2025 | 25.x | Tested — minimum supported | manual checklist (`docs/test-runs/`) |

Legend:

- **Tested** — a full manual checklist run (`docs/test-runs/`) completed on this version.
- **Supported** — the version installs and is expected to work, but no run is recorded yet.

To list a new version, run the checklist on it and add a row. The steps are in the runbook
for a new After Effects release: [`runbook-new-ae-release.md`](runbook-new-ae-release.md).
