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

Interoperate with third-party tools **only through the observable After Effects object
model** — what an applied preset leaves on a layer (markers, marker parameters, effects,
expressions). Do **not** read, copy or redistribute their files, and do **not**
reverse-engineer or deobfuscate their code (a scope choice, not a legal bar — see
Alternatives).

From Mac 1 (AE 2026, Animation Composer 4.2.6, Motion 2):

1. Animation Composer has **no on-disk preset library** to read: it ships no preset files
   and keeps an applied preset's data in marker parameters namespaced `zzzzzzzzzzzzzzz_AC`.
   A generated `getAnimationComposerPresetValue()` expression reconstructs the motion at
   render time. AE's own `.ffx` presets are separate and file-readable.
2. A preset surfaces as markers (timing comments), renamed effects (`AC IN …`/`AC OUT …`)
   and expressions — all visible through the existing markers and expressions tooling
   (E14-6, E14-7). Marker **parameters** are the one unsurfaced part.
3. Motion exposes no script entry point (obfuscated `Motion 2.jsxbin` panel).
4. Both vendors' EULAs claim to forbid extraction and reverse engineering. Within the EU a
   clause like that cannot override the interoperability exception in the Software Directive
   (Art. 6 and 8), so the law is **not** the reason for this decision — see Alternatives.

**Outcome for the gated tasks:** E14-9 (third-party library paths), E14-10
(`thirdparty.search`) and E14-11 (`thirdparty.apply_preset`) are **not supported** — there
is no readable library and no supported way to apply a preset without driving the panel.
Story 14.5 (utility operations) covers the user need instead. E14-3 (retry when AE reports
a script running) stays: their panels occupy the single scripting thread.

_(Mac 2 and the live collision test (question 4) are still pending; the owner sets Status to
Accepted or Rejected once both Macs are run.)_

## Consequences

- The operation catalog (BACKLOG §8) gains no third-party operations; presets are read, not
  applied. Claude works with what an applied preset produced.
- Suggested follow-up (new task, not gated): expose **marker parameters** in `ae_layer_info`
  so the `zzzzzzzzzzzzzzz_AC` timing can be read. Not part of E14-9..11.
- E14-3, E14-6, E14-7 and E14-8 are the interop surface and remain as built.

## Alternatives considered

- **Reverse-engineer for interoperability.** In the EU, Directive 2009/24/EC Art. 6 permits
  decompilation to achieve interoperability of an independently created program, Art. 8
  voids contract terms to the contrary, and the Trade Secrets Directive (EU) 2016/943
  Art. 3(1)(b) treats disassembly of a lawfully held product as lawful — so the EULA clauses
  are not an absolute bar. **Rejected on technical and scope grounds**, not legal: AC needs
  no decompilation (its preset data lives in AE's own object model), and Motion ships
  obfuscated JSXBIN whose deobfuscation would target "running their tools", i.e. functional
  cloning rather than interoperability (outside Art. 6(2)). Revisit only if a lawyer signs
  off on an apply-by-name feature. Not legal advice — consult counsel before shipping.
- **Drive their panels** (UI automation / CEP hooks). Rejected: question 3 found no script
  entry point, and AC's CEP host is minified and fragile to call.
- **Read/apply their preset libraries directly** (`.ffx` or project assets). Rejected:
  question 1 found no on-disk library.
- **Do nothing** — users keep applying presets by hand; ae-mcp stays preset-agnostic. This is
  what we do for *applying* presets, while still *reading* what they leave.

## Verification

- `docs/spike/third-party.md` filled on both Macs.
- Decisions here are consistent with the answers, and E14-3/E14-9/E14-10/E14-11
  are re-read against them.
