# ADR-0012: Backup modes, a backup folder, and settings in the Claude panel

Date: 2026-10-18
Status: Accepted
Authors: Stanislas Dolcini (decider), Claude
Decider: Stanislas Dolcini (engineer)
References: ADR-0009, #264

## Context

Before every destructive operation the server runs `project.increment_save`, which makes a new
numbered copy next to the project and switches After Effects to it. One evening of work left
`Latent_v004.aep` to `Latent_v017.aep` in the user's Documents folder, and the open project kept
changing name. The only switch, `incrementBeforeDestructive`, is a hidden boolean in
`~/.ae-mcp/settings.json`. Some users want no backups, some want a single one.

## Decision

1. `settings.json` gains `backupMode`: `"single"` (default), `"increment"` or `"off"`, and
   `backupKeep` (default 5, increment mode only). The legacy `incrementBeforeDestructive: false`
   maps to `"off"`, an explicit `true` to `"increment"`.
2. Backups go to `~/.ae-mcp/backups/<project name>/`, never next to the project. The open project
   keeps its file name: the server saves the project in place, then copies the `.aep` into the
   backup folder (`single` overwrites one file; `increment` adds a timestamped copy and keeps the
   newest `backupKeep`).
3. People change settings in the Claude panel inside After Effects. Claude can read the settings
   (`check_setup` lists them) but has no tool to change them, so it cannot switch off its own
   backups.
4. The panel file is named `Claude for After Effects.jsx`, so the Window menu reads
   "Claude for After Effects".

## Consequences

- A destructive operation now saves the user's own project file before it runs (like Cmd+S).
- Old numbered copies already on disk are left alone.

## Alternatives considered

- Keep increments with a cap only; a single-backup-only mode; backups next to the project; an
  installer settings page; a writable settings tool for Claude (rejected: Claude could disable its
  own safety net).

## Verification

Unit tests for each mode and the legacy mapping; a live drive step that runs a destructive
operation in each mode and checks the open project name is unchanged.
