# ADR-0002: Third-party tool support

Date: 2026-10-13
Status: Proposed
Authors: Stan (owner)
References:
- `docs/spike/third-party.md` (E14-1 run instructions + results template)
- `packages/spike/third-party/investigate.jsx` (investigation script)
- `docs/BACKLOG.md` §E14 (this epic and the `[GATE ADR 0002]` tasks E14-3, E14-9, E14-10, E14-11)

## Context

AE users reach for third-party motion tools that live inside After Effects as
extension panels:

- **Animation Composer** (Mister Horse) — applies motion presets by drag and
  drop, with timing carried on layer markers.
- **Motion** (Mt. Mograph) — 40+ tools for anchors, easing, delay and
  expressions.

Neither publishes a documented scripting API. Before ae-mcp can interoperate —
read what a preset leaves behind, or re-apply a preset by name — the spike
(E14-1/E14-2) must answer:

1. Where Animation Composer presets are stored, and in what format (`.ffx`
   files, or precomps inside a project).
2. What a preset leaves on a layer — markers, expressions, effects.
3. Whether Motion exposes any script entry point, or only a panel UI.
4. Whether their panels cause a "second script" collision with our bridge.
5. What their license terms say about automating or reading their libraries.

## Decision

_Pending spike results — fill from `docs/spike/third-party.md` (both Macs), then
set Status to Accepted or Rejected._

## Consequences

_Pending. Record the impact on the `[GATE ADR 0002]` tasks (E14-3, E14-9,
E14-10, E14-11) and on the operation catalog (BACKLOG §8)._

## Alternatives considered

- **Drive their panels** (UI automation / CEP hooks). Only viable if question 3
  finds a supported entry point.
- **Read/apply their preset libraries directly** (`.ffx` or project assets).
  Only viable if question 1 confirms a stable on-disk format.
- **Do nothing** — users keep applying presets by hand; ae-mcp stays
  preset-agnostic. Safe default if licenses (question 5) forbid automation.

## Verification

- `docs/spike/third-party.md` filled on both Macs.
- Decisions here are consistent with the answers, and E14-3/E14-9/E14-10/E14-11
  are re-read against them.
