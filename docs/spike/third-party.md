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
   - **Motion 2 (Mt. Mograph) — the "Burst" tool — applied to `MOTION TARGET` in
     `MOTION TEST`:** does **not** annotate the selected layer (MOTION TARGET is byte-identical
     after). It inserts a **new shape layer named `Burst` above** the target, holding:
     - **18 effects, all expression controls** (`ADBE Point Control`, `ADBE Slider Control`,
       `ADBE Checkbox Control`, `ADBE Color Control`) with user-facing names `Global Position`,
       `# of Copies`, `Copies Revolution`, `Revolution Offset`, `Burst Offset`,
       `Distance from Center`, `Link Width & Height`, `Burst Width`, `Burst Height`,
       `Stroke Width`, `Fill On | Off`, `Fill Color`, `Stroke On | Off`, `Stroke Color`,
       `Burst Roundness`, `Link Seq. Width & Height`, `Sequential - Width`, `Sequential - Height`
     - a vector shape tree (Rectangle → Repeater → Stroke → Fill → Wiggle Transform) whose
       size, position, roundness, copies, scale, rotation and colors are all driven by
       **expressions** reading those effect controls, e.g.
       `effect("Burst Width")("ADBE Slider Control-0001")`; layer `Position` is wired to
       `effect("Global Position")("ADBE Point Control-0001")`
     - **0 markers, 0 keyframes** — the animation is fully parametric (expressions + effect
       controls), not baked
     → Motion tools are observable and reversible through AE's object model: they are a new
     layer with expression-control effects and a wired expression graph.
3. Motion script entry point: none. Motion 2 is a compiled/obfuscated
   `ScriptUI Panels/Motion 2.jsxbin`; no `.jsx`, CEP host, or documented API.
4. 'Second script' collisions with the bridge (tested live): AE runs one script at a time and
   `DoScriptFile` **blocks until the script finishes**, returning `app.exitCode` (verified:
   exit code 42 round-trips; a write script returns 0 and its file appears). A second
   `DoScriptFile` while one is mid-run is **refused with a modal dialog**, and the osascript
   call blocks until it is dismissed — observed (French) "tentative d'exécuter un second
   script pendant l'exécution d'un script, impossible d'exécuter le second script"; if left
   up it wedges AE until dismissed and AE is restarted. The AppleScript dictionary
   (`Contents/Resources/ae.sdef`) documents the escape hatch: both `DoScriptFile` and
   `DoScript` take an optional boolean **`override`** — "Allow one script to interrupt and run
   while another script is running". So the failure mode is a blocking modal, not a returned
   error. Consequence for E14-3: the `SCRIPT_RUNNING` text heuristic
   (`/…second script…/i` in `packages/server/src/osascript-transport.ts`) matches the dialog
   wording but never sees it — nothing is returned until the dialog is dismissed — so
   `AE_BUSY` needs a **timeout** on the osascript call (and/or `with override`). Decision
   needed: timeout-and-retry vs. `override`-interrupt. (Observed on Mac 1; the reverse
   direction — panel open while a bridge job runs — is not yet exercised.)
   - **Reverse direction (partly exercised, Mac 1):** with the Motion 2 workflow just used
     (its panel open), a bridge job — `ae_project_info` run through the osascript
     `DoScriptFile` transport — completed normally. So our job does not obviously collide with
     an open third-party panel. Repeated/edge cases and the reverse (their tool running while
     our job starts) remain untested.
5. License terms on automating or reading libraries: Mister Horse EULA
   (misterhorse.com/terms-of-use) — non-transferable; end user "cannot extract or use the
   Product, Software and/or Content separate from the Work". Mt. Mograph EULA
   (mtmograph.com/pages/eula, 2024-10-11) — "may not reverse engineer, decompile, or
   disassemble". → Read only what a preset leaves through AE's object model; do not read or
   extract their files, and do not deobfuscate Motion.

_Note: question 2 now covers both Animation Composer (a preset) and Motion 2 (the "Burst"
tool). An earlier Motion attempt left nothing detectable — that was a mis-application (the
tool was not actually invoked), not a property of Motion: when it really runs it adds a new
parametric shape layer. E14-2's ADR should treat Motion output as readable through the AE
object model._

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
