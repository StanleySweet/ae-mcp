---
name: ae
description: Recipes for driving Adobe After Effects through the ae-mcp tools (ae_catalog, ae_do, ae_plan/ae_apply, ae_render_frame). Use when building or editing animation in After Effects.
---

# After Effects with ae-mcp

Recipes for the ae-mcp tools. `ae_catalog` lists every operation with its argument schema. `ae_do` runs one as `{op, args}`. Times are seconds, positions are comp pixels, colours are `[r, g, b]` from 0 to 1. Property paths use match names, such as `ADBE Transform Group/ADBE Position`, never display names.

## Before you start

1. `check_setup`: every gating check must be green before you change anything.
2. `ae_context` (active comp, selection, busy state) and `ae_project_info` (project and items).
3. If `project_saved_version` fails, the project was never saved. Save once with `ae_do {op: "project.save", args: {path: "<absolute path>.aep"}}`. Destructive ops refuse an unsaved project with `UNSAVED_PROJECT`.
4. Inspect what is there with `ae_layer_info {comp}` and `ae_expression_report {comp}`, then change it. Do not rebuild existing structures.

## Keyframes or expressions

Read `docs/agents/animation-principles.md` first. Hand-authored motion gets keyframes. Procedural, random or linked motion gets an expression.

Keyframed move with easing:
1. `ae_do {op: "keyframe.add", args: {comp, index: 3, property: "ADBE Transform Group/ADBE Position", time: 0, value: [200, 540]}}`
2. Same call at `time: 1` with `value: [960, 540]`.
3. `keyframe.set_easing` with `{comp, index, property, time, easing}`; easing is `linear`, `ease`, `easeIn`, `easeOut` or `hold`.
4. Or select the keys in AE and run `keyframe.ease_preset {comp, index, property, preset}`; preset is `ease_in`, `ease_out` or `overshoot`.

Procedural motion:
1. Built-in: `expression.snippet {comp, index, property, snippet: "wiggle", amplitude, frequency}`. Snippets are wiggle, loop, delay, overshoot, loop_pingpong, inertia, inertia_strong, bounce, bounce_soft, bounce_hard, time_counter, countdown, count_up, wiggle_smooth, loop_cycle, loop_offset, spring, clock, random_flicker and follow (`target` = layer name, `delay` seconds).
2. Custom: `expression.set {comp, index, property, value: "<code>"}`, then `expression.check_errors` with the same target.
3. Remove with `expression.clear`. Read an existing expression or keyframe set before you replace it.

## Build a layered scene

1. Background: `layer.add_solid {comp, color: [0.08, 0.1, 0.14]}`.
2. Shape layer with a named shape: `shape.add {comp, layerName: "Accent bar", type: "rect", size: [400, 120], position: [200, 60], fillColor: [1, 0.4, 0.1], fillOpacity: 100}`. Omit `layerIndex` to create the layer. Each new group is drawn behind existing groups unless `front: true`.
3. Adjust a shape later with `shape.set {comp, layerIndex, group: 1, position, fillOpacity, groupPosition, groupScale, groupRotation, groupOpacity, front}`. `shape.read {comp, layerIndex}` lists each group's items and transform first.
4. Text: `text.add {comp, text: "Title", fontSize: 96, fillColor: [1, 1, 1], font, justification}`.
5. Place a layer: `layer.set_transform {comp, index, anchorPoint, position, scale, rotation, opacity}`; pass only the fields you change. Scale is `[100, 100]` style percentages.
6. Parent only after checking the child's own keyframes: `layer.set_parent {comp, index, parent}`.
7. Name a layer with `layer.rename {comp, index, name}`. Use `bulk.rename` only for many layers at once (see Bulk edits).

Layer ops accept `layer` in place of `index`: a 1-based index, an exact layer name (if several layers share it the call fails and lists their indices and ids), or `{id: n}` for the layer id. `index` keeps working.

## Parallax loop

Background layer, speed `s` in pixels per second, wrapping every comp width. Set this as the Position expression:

```
var s = 120;
var w = thisComp.width;
[((value[0] - s * time) % w + w) % w, value[1]]
```

Apply with `expression.set {comp, index, property: "ADBE Transform Group/ADBE Position", value: "<code>"}`. Start `value[0]` at the layer's start x. A wrap shows a seam unless the art is at least comp-wide. For narrower art, add a second copy offset by `w`.

## Lower third, title card and transitions

1. `template.lower_third {comp, title, subtitle, duration, style}` (duration in seconds, default 4; `style` `classic` (default), `modern`, `minimal` or `news`). It returns the created layer indices.
2. `template.title_card {comp, title, subtitle, duration, style}` builds a full-comp solid with a centred title. `style` `default` (dark, scales in), `cinematic` (black, slow fade) or `minimal` (light, quick fade). It returns the created layer indices.
3. Restyle either with `text.set` or `property.set` on those indices.

## Polish

1. Transition between two layers: `template.transition {comp, from, to, style, duration}`, with `style` `fade`, `push`, `zoom` or `wipe` (Linear Wipe on `from`). `to` starts at `from`'s out point minus `duration`.
2. Reveal one layer: `template.logo_reveal {comp, index, style}`, with `style` `fade_scale`, `slide`, `spin` or `glitch` (Turbulent Displace plus a flicker). It animates over 0.8 s from the layer's in point.
3. Add a look: `look.apply {comp, index, look}`, with `look` `glow`, `soft_blur`, `film_grain`, `drop_shadow`, `vignette`, `neon`, `vhs`, `chromatic`, `duotone` or `cinematic`. The effects get tuned starting values, not checked on live AE, so adjust them in the Effect Controls afterwards.
4. Import footage in bulk with `project.import_folder {path, recursive, folder}`. Files AE refuses are listed in `skipped`.

## Check your work

1. Before a change: `ae_do {op: "comp.snapshot", args: {comp}}` and keep the result. It lists each layer with its index, name, in/out, transform values, effects and expression flags.
2. After the change: `ae_do {op: "comp.diff", args: {comp, snapshot: <the result from step 1>}}`. It reports added and removed layers and changed fields.
3. `ae_render_frame {comp, time}` at two or three times (start, middle, end). Use `maxEdge` to shrink large frames.
4. For a motion check, `property.sample {comp, index, property, times}` returns values at the given times.
5. Read every `warning` in a result. It names an expression-driven property, so edit its driver instead.

## Bulk edits: plan, then apply

1. `ae_plan {op: "bulk.rename", args: {comp, layers: [2, 3], match: "Shape", replace: "Card", regex: false}}` returns `{planId, changes}`. Review `changes`.
2. `ae_apply {planId}` runs it as one undo group. A plan that expired or was made before the project changed is refused (`PLAN_EXPIRED` or `PLAN_CHANGED`). Plan again.
3. The same pattern works for `bulk.set_property`, `bulk.stagger`, `bulk.replace_text` and the other `bulk.*` ops.

## Batches

1. `ae_do {op: "batch.run", args: {ops: [{op: "layer.add_solid", args: {...}}, {op: "shape.add", args: {...}}], atomic: true}}`.
2. The batch is one undo group. If a step fails after a change, the whole batch rolls back (Edit > Undo).
3. Never put `project.save`, `project.open`, `project.new` or `project.increment_save` in a batch. Run them alone.
4. A failed batch is not undone automatically: it is one undo step, so ask the user to press Cmd+Z once in After Effects to revert it.
4. Destructive steps trigger one incremental save for the whole batch.

## When a dialog blocks AE

1. A call that times out with `DIALOG_OPEN` means a modal dialog is open.
2. `ae_dialogs {action: "list"}` shows its title and text.
3. `ae_dialogs {action: "dismiss"}` presses Cancel or Escape. It never presses Save or Don't Save.
4. This needs Accessibility permission for the MCP client. Without it, `ae_dialogs` says so.
