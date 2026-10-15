# Finding: the bridge, the mock AE and the fake bridge disagree about ExtendScript

Date: 2026-10-15
Area: `packages/bridge` (ExtendScript payload + mock AE), `packages/fake-bridge`, `packages/server`
Issue: #166, #161 (see below)

## What happens

A Claude Desktop session drove the bridge hard and hit a run of bugs that all
shared one shape: **the mock (and sometimes the fake bridge) did not model the
real ExtendScript environment faithfully**, so the tests were green while AE
failed. Each mismatch is a trap that can be re-planted by a future edit.

## Traps, bridge-side

- **`app.scheduleTask` takes a string, not a function.** The code string is
  evaluated later in the global scope. The loader originally passed closures, so
  the 30-second heartbeat refresh and the 200 ms job poll silently never ran
  after the first beat. Mock AE now rejects a non-string (like real AE).
- **`$.evalFile` evaluates in the caller's local scope.** A `var AEMCP` in the
  payload was invisible to the loader on later beats, so capabilities stayed
  empty. The payload now exports through `$.global.AEMCP = AEMCP`; the mock's
  `evalFile` wraps code in a function so `var` does not leak to the global.
- **Localized menu names.** `app.findMenuCommandId('Increment and Save')`
  returns null on a non-English AE (our Mac 1 is `fr_FR`). `project.increment_save`
  now does the Save-As natively (`app.project.save(new File(...))`) instead of
  driving a menu command by its English name.
- **Temporal eases are per-dimension.** `setTemporalEaseAtKey(keyIndex, in, out)`
  needs **one `KeyframeEase` per `prop.numDimensions`** (Scale is 3). A
  single-element array fails. `keyframe.set_easing` now builds one per dim.
- **Transform properties are nested.** Scale/Rotation/Opacity live under the
  `ADBE Transform Group`, not at the layer top level, so `layer.property('Scale')`
  returns null. `keyframe.*` now use `aemcpResolveProperty` (path/name search).
- **`setEasingAtTime` is not an AE API.** The real sequence is
  `setInterpolationTypeAtKey` then `setTemporalEaseAtKey`.
- **`.payload-version` survives an AE restart.** A marker left on disk made a fresh
  session skip the reload with no `AEMCP` defined. The built payload now embeds
  the git revision (`0.0.0+<sha>[-dirty]`), so a fresh build changes the stamp.

## Traps, mock/fake-side

- The mock must **not** be more permissive than AE (functions to `scheduleTask`,
  shared-global `evalFile`, English-only menu ids) or the tests cannot catch the
  bugs above.
- `menuCommandIds` is still `readonly`; fine today because `increment_save` no
  longer uses it, but a French-map test would need it mutable.
- The fake bridge once hardcoded `compInfo` fields and hid `findComp`; both are
  fixed and the fake now models `inLayer.in/outPoint`, `pixelAspect`, `duration`,
  `bgColor` and throws `HandlerError`.

## Trap: a stale installed payload looks like a logic bug

The single most expensive confusion of the session: **the guard's failure was not
the easing code**. `keyframe.remove` is destructive, so its `batch.run` ran
`project.increment_save` first; the *installed* `current.jsx` was many commits
stale, so the increment failed and the guard aborted the whole batch before the
easing code ever ran. See `2026-10-14-stale-bridge-payload.md`. Always check
`ae_version_info` before trusting a live run.

## Trap: the guard blamed the wrong thing

When `project.increment_save` returned `success !== true` for **any** reason, the
guard answered a hardcoded `UNSAVED_PROJECT` ("the project has never been saved"),
even when the project *had* a file. That pointed every operator at the wrong
problem. #161: the bridge now tags the genuine case with
`code: 'PROJECT_NEVER_SAVED'`, and the guard returns the bridge's real error
(`SCRIPT_ERROR`) otherwise. The guard itself is not weakened.

## Where to look

- `packages/bridge/src/serializers.js` (`aemcpIsGroup`), `handlers.js`
  (`aemcpResolveProperty`, `keyframe.*`, `project.increment_save`),
  `loader.js`/`job-runner.js` (`scheduleTask`, `$.global.AEMCP`).
- `packages/bridge/src/mock-ae.ts` (fidelity), `packages/server/src/server.ts`
  (guard, ~L626-649 and ~L762-786).
