# Finding: the installed bridge payload can be many commits stale

Date: 2026-10-14
Area: bridge install (`~/.ae-mcp/bridge/current.jsx`, `bundle/manifest.json`)
Issue: none yet (see "Candidate fix" below)

## What happens

The bridge AE actually runs is the payload **copied into** `~/.ae-mcp/bridge/current.jsx`
at install time. It does not track the working tree. After several commits the
installed payload was `0.0.0+f2ef9e8-dirty` — **12 commits behind** `main` — so a
live checklist run was exercising old bridge code without any sign of it: the
version only shows up if you read `ae_version_info`/`ae_context`.

## Evidence

On Mac 1 (AE 2026, fr_FR), human checklist row 14:

- `ae_do layer.delete` failed with `UNSAVED_PROJECT "…destructive and the project
  has never been saved"`, although the open project **did** have a file. The real
  cause was the stale payload: its `project.increment_save` handler did not match
  the current bridge, so the guard's increment step failed.
- `f2ef9e8` is an ancestor of `HEAD`, 12 commits behind.
- After `npm run bridge:build` + copying `packages/bridge/dist/payload.jsx` to
  `~/.ae-mcp/bridge/current.jsx` (version `0.0.0+344cdcb5-dirty`), the same call
  got past the guard and hit the real bug (the `comp.removeLayer` one, #160).

The osascript transport `$.evalFile`s `current.jsx` fresh on every call, so
swapping the file takes effect immediately — no AE restart needed.

## Trap to remember

A live checklist result only means what the **installed payload version** says.
Check `ae_version_info` before trusting a run, and reinstall the payload
(`bridge:build` + copy to `~/.ae-mcp/bridge/current.jsx`) after any bridge change.
`apps/installer` does this during setup; manual testing must do it by hand.

## Candidate fix

`packages/server/src/server.ts` (~L618-650) collapses every non-success
`project.increment_save` into a hardcoded `UNSAVED_PROJECT` message, which hid the
real "never saved" vs "increment failed" distinction and pointed at the wrong
problem. Surface the bridge's actual error when `success !== true`. Needs its own
issue before touching the guard.
