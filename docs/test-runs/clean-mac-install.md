# E11-7 clean-Mac install test: run instructions and results template

Backlog task E11-7 — run on a clean Mac by the owner, fill the template below,
then record the row 11 result in `docs/test-runs/<date>.md`. This exercises the
release artifacts (`AE-MCP Setup-<version>-<arch>.dmg`, `ae-mcp.mcpb`,
`SHA256SUMS.txt`) produced by `.github/workflows/release.yml`, and checklist row
11 in `docs/BACKLOG.md` §9.

## What "clean Mac" means

- ae-mcp / **AE-MCP Setup** has never been installed, and there is no `~/.ae-mcp`
  directory. Use a spare Mac, a fresh macOS user account, or delete `~/.ae-mcp`
  and the app first.
- After Effects is installed and licensed (2025 or newer).
- Claude Desktop is installed.

## Setup

- **Machine / macOS:** `___`
- **AE version:** `___`
- **Release tag:** `v___`

## Run

1. Download the release artifacts from the GitHub Release for the tag. Verify
   checksums: `shasum -a 256 -c SHA256SUMS.txt` (from the folder you downloaded
   into).
2. Open the `.dmg` and drag **AE-MCP Setup** into Applications.
3. First launch is unsigned. Double-click **If Setup will not open.command** in the
   dmg window (it runs `xattr -cr` on the installed app), or right-click the app,
   **Open**, then confirm. If
   macOS still blocks it, run
   `xattr -dr com.apple.quarantine "/Applications/AE-MCP Setup.app"` and open it
   again.
4. Step through the Setup wizard. It should, in order: install the MCP bundle
   into Claude Desktop, install the bridge loader into the AE Scripts folder,
   and hand the `.mcpb` to Claude (this opens Claude with the bundle). Confirm
   each checklist row turns green.
5. Quit and reopen Claude Desktop. Confirm the ae-mcp tools are listed.
6. In Claude, run `check_setup`. It must be all green.
7. Open a throwaway project in After Effects and ask Claude for
   `ae_project_info`. It must match what AE shows.
8. Time it: from opening the `.dmg` to the green live test. Target **under 5
   minutes**.

## Results template

Fill one block per run.

### Run

- Machine / macOS: `__`
- AE version: `__`
- Release tag / version: `__`

1. Checksums matched: `__`
2. Time from opening the `.dmg` to green live test: `__`
3. Setup wizard rows, and any that needed the Fix button: `__`
4. Claude Desktop listed the ae-mcp tools after reopen: `__`
5. `check_setup` result: `__`
6. Friction, prompts, or security warnings (and how you cleared them): `__`

## Next

Record the row 11 result (pass/fail + time) in `docs/test-runs/<date>.md`. Any
failure becomes a follow-up issue; do not fold fixes into this task.
