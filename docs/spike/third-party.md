# E14-1 third-party spike: run instructions and results template

Backlog task E14-1 — run on both Macs by the owner, fill the template below, then
these answers feed E14-2 (`docs(adr): 0002 third-party tool support`). The
investigation script lives at
`packages/spike/third-party/investigate.jsx`.

## Setup

- After Effects 2025 or newer, licensed. Record the exact version (it matters):
  **AE version:** `26.5x89 (After Effects 2026)`
- Animation Composer (Mister Horse) installed, and Motion (Mt. Mograph) if you
  have it.

## Run

1. In After Effects, open the comp you want to inspect (or create one).
2. **File > Scripts > Run Script File...** and pick
   `packages/spike/third-party/investigate.jsx`. If AE warns about scripts
   writing files, allow it (Preferences > General > "Allow Scripts to Write Files
   and Access Network").
3. The script writes `~/Desktop/ae-mcp-thirdparty-report.txt` silently (no dialog).
4. Copy the relevant sections into the template below.

For the preset dump, run the script **twice**: once on an empty comp, then apply
a preset by hand (for example drag an Animation Composer preset onto a layer, or
run a Motion tool) and run it again. Diff the two reports — what the preset
added is the answer to question 2.

## Questions

Answer each; these are Story 14.1's acceptance criteria.

1. **Where are Animation Composer presets stored, and in what format** (for
   example `.ffx` files, or precomps inside a project)?
2. **What does a preset leave on a layer** — markers (comments/durations),
   expressions, effects? Paste the diffed report.
3. **Does Motion have any script entry point** (a `.jsx`/CEP hook, or only its
   panel UI)?
4. **Do their panels cause a 'second script' collision with our bridge?** With
   the panel open and in use, do bridge jobs still complete (and vice versa)?
5. **What do their license terms say about automating or reading their
   libraries?**

## Results template

Fill one block per Mac.

### Mac 1

- Machine / macOS: `27.0.1 (build 26A434)`
- AE version: `26.5x89 (After Effects 2026, fr_FR)`

1. Preset storage and format: Animation Composer (CEP `com.misterhorse.AnimationComposer`
   4.2.6) ships **no** preset files — the extension is panel code only (16 MB, zero
   `.ffx`/`.aep`/pack files). Presets are downloaded packs, and the applied preset's data
   lives **on the layer**, not in a file: marker parameters namespaced `zzzzzzzzzzzzzzz_AC`
   (`MarkerEnabled`, `MarkerType`, `MarkerAppPresetType`). AE's own presets are `.ffx` under
   `/Applications/Adobe After Effects 2026/Presets/` (unrelated to AC).
2. What a preset leaves on a layer (diff of empty comp → after applying "LDR Title" to a
   shape layer):
   - markers `@0.567s "TR In"` and `@4.299s "TR Out"`, duration 0
   - effects renamed `AC IN [LKC] Gaussian Blur` and `AC OUT [LKC] 2 Gaussian Blur`
     (both `ADBE Gaussian Blur 2`)
   - expressions on `Opacity` and each blur's `Flou` calling a generated
     `getAnimationComposerPresetValue()`, which reads the `zzzzzzzzzzzzzzz_AC*` marker
     parameters; each expression carries a 192-hex preset fingerprint in its header
3. Motion script entry point: none. Motion 2 is a compiled/obfuscated
   `ScriptUI Panels/Motion 2.jsxbin`; no `.jsx`, CEP host, or documented API.
4. 'Second script' collisions with the bridge: not tested live. Bridge calls osascript
   `DoScriptFile`, which AE refuses while another script (a panel) runs → `AE_BUSY`,
   retried with backoff (E14-3, `packages/server/src/osascript-transport.ts`). Live test
   with each panel open still pending.
5. License terms on automating or reading libraries: Mister Horse EULA
   (misterhorse.com/terms-of-use) — non-transferable; end user "cannot extract or use the
   Product, Software and/or Content separate from the Work". Mt. Mograph EULA
   (mtmograph.com/pages/eula, 2024-10-11) — "may not reverse engineer, decompile, or
   disassemble". → Read only what a preset leaves through AE's object model; do not read or
   extract their files, and do not deobfuscate Motion.

_Note: only Animation Composer was applied for question 2; a Motion tool left nothing
detectable and still needs a run._

### Mac 2

- Machine / macOS: `__`
- AE version: `__`

1. Preset storage and format:
   `__`
2. What a preset leaves on a layer (paste the diff):
   `__`
3. Motion script entry point:
   `__`
4. 'Second script' collisions with the bridge:
   `__`
5. License terms on automating or reading libraries:
   `__`

## Next

E14-2 runs this on both Macs and commits the answers as
`docs/decisions/0002-third-party-tools.md`. The answers set the scope of the
`[GATE ADR 0002]` tasks (E14-3, E14-9, E14-10, E14-11).
