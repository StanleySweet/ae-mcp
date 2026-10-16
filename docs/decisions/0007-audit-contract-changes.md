# ADR-0007: Contract changes from the 2026-10-17 repo audit

Date: 2026-10-17
Status: Accepted
Authors: Stan (decider), Claude (drafting)
Decider: Stan, who asked for every audit finding to be fixed as an issue
References: #178, #180, #181, #185, #186

## Context

A whole-repo audit found five defects whose fix changes what `ae_do` callers see:

- `render.frame` is read-only but writes a PNG wherever its `file` argument points (#178).
- `render.queue_start` blocks AE past the job deadline, and a retry renders again (#180).
- Handlers report failures as `{success:false}` inside an `ok` result, so `batch.run`
  continues past a failed step (#181).
- `shape.add` uses `name` for the layer, or ignores it, never for the shape (#185).
- Every `ae_do` makes an extra AE round trip for a `context` that is usually empty (#186).

## Decision

- `render.frame` loses its `file` argument. Frames always go to `<queue root>/render/`.
- `render.queue_start` is removed. `ae_render` (aerender, background job) renders.
- A handler result with `success === false` becomes an `INVALID_ARGS` error carrying its
  `error` message. `batch.run` stops there.
- `shape.add`'s `name` names the shape group. A layer created by the call is named by
  `layerName`.
- `ae_do` no longer attaches `context`. Callers use `get_selection`.

## Consequences

Clients that passed `render.frame.file`, called `render.queue_start`, read
`{success:false}` from an ok result, or read `ae_do`'s `context` must adapt. The
model-facing descriptions and docs change in the same commits.

## Alternatives considered

- Keep `render.queue_start` behind a longer per-op deadline: AE stays frozen for the
  whole render, and `ae_render` already covers the need.
- Keep `{success:false}` and teach `batch.run` to stop on it: leaves `ae_do` reporting
  failures as successes.

## Verification

Each issue's commit carries a test for its new contract. `npm run check` is green.
