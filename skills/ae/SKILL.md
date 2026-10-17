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
1. Built-in: `expression.snippet {comp, index, property, snippet: "wiggle", amplitude, frequency}`. Snippets are wiggle, loop, delay, overshoot, loop_pingpong, inertia, bounce, time_counter, countdown.
2. Custom: `expression.set {comp, index, property, value: "<code>"}`, then `expression.check_errors` with the same target.
3. Remove with `expression.clear`. Read an existing expression or keyframe set before you replace it.

## Build a layered scene

1. Background: `layer.add_solid {comp, color: [0.08, 0.1, 0.14]}`.
2. Shape layer with a named shape: `shape.add {comp, layerName: "Accent bar", type: "rect", size: [400, 120], fillColor: [1, 0.4, 0.1]}`. Omit `layerIndex` to create the layer.
3. Text: `text.add {comp, text: "Title", fontSize: 96, fillColor: [1, 1, 1], font, justification}`.
4. Place a layer: `layer.set_transform {comp, index, position: [960, 540]}`. Scale with `property.set {comp, index, name: "ADBE Transform Group/ADBE Scale", value: [80, 80]}`.
5. Parent only after checking the child's own keyframes: `layer.set_parent {comp, index, parent}`.
6. Rename an existing layer through a bulk plan (see Bulk edits). `layer.rename` does not exist.

## Parallax loop

Background layer, speed `s` in pixels per second, wrapping every comp width. Set this as the Position expression:

```
var s = 120;
var w = thisComp.width;
[((value[0] - s * time) % w + w) % w, value[1]]
```

Apply with `expression.set {comp, index, property: "ADBE Transform Group/ADBE Position", value: "<code>"}`. Start `value[0]` at the layer's start x. A wrap shows a seam unless the art is at least comp-wide. For narrower art, add a second copy offset by `w`.

## Lower third and title card

1. `template.lower_third {comp, title, subtitle, duration}` (duration in seconds, default 4). It returns the created layer indices.
2. Restyle with `text.set` or `property.set` on those indices.
3. `template.title_card` is not in `operations.ts`. Do not call it.

## Check your work

1. Before a change: `ae_layer_info {comp}`, and `ae_comp_info {comps: ["Main"]}` for comp settings. No `comp.snapshot` or `comp.diff` op exists, so compare the two reports yourself.
2. After the change: repeat `ae_layer_info {comp}` and compare.
3. `ae_render_frame {comp, time}` at two or three times (start, middle, end). Use `maxEdge` to shrink large frames.
4. Read every `warning` in a result. It names an expression-driven property, so edit its driver instead.

## Bulk edits: plan, then apply

1. `ae_plan {op: "bulk.rename", args: {comp, layers: [2, 3], match: "Shape", replace: "Card", regex: false}}` returns `{planId, changes}`. Review `changes`.
2. `ae_apply {planId}` runs it as one undo group. A plan that expired or was made before the project changed is refused (`PLAN_EXPIRED` or `PLAN_CHANGED`). Plan again.
3. The same pattern works for `bulk.set_property`, `bulk.stagger`, `bulk.replace_text` and the other `bulk.*` ops.

## Batches

1. `ae_do {op: "batch.run", args: {ops: [{op: "layer.add_solid", args: {...}}, {op: "shape.add", args: {...}}], atomic: true}}`.
2. The batch is one undo group. If a step fails after a change, the whole batch rolls back (Edit > Undo).
3. Never put `project.save`, `project.open` or `project.undo` in a batch. Run them alone.
4. Destructive steps trigger one incremental save for the whole batch.

## When a dialog blocks AE

1. A call that times out with `DIALOG_OPEN` means a modal dialog is open.
2. `ae_dialogs {action: "list"}` shows its title and text.
3. `ae_dialogs {action: "dismiss"}` presses Cancel or Escape. It never presses Save or Don't Save.
4. This needs Accessibility permission for the MCP client. Without it, `ae_dialogs` says so.
