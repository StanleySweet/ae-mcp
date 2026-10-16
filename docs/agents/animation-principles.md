# Animation Principles

Shared context for any agent that drives the After Effects MCP. Load this before
proposing or editing motion, so every session treats animation the same way.

## Animation priority

- Prefer native After Effects keyframes for explicit, hand-authored animation.
- Use expressions when procedural behavior, automatic updates, mathematical relationships, or reusable logic provide a meaningful benefit.
- Do not replace existing expressions or keyframes without understanding their purpose.
- Preserve existing animation wherever possible.

## Naming conventions

- Use descriptive, consistent names for compositions, layers, controllers, and effects.
- Avoid ambiguous names such as Null 12, Layer 4, or Comp 7 when a meaningful name is available.
- Preserve established naming patterns in existing projects.
- Avoid renaming user-created elements without a reason.

## Project awareness

- Inspect the composition, selected layers, existing keyframes, and expressions before making changes.
- Prefer modifying existing structures over rebuilding them.
- Reuse existing controllers and animation rigs where practical.
- Respect layer order, parenting, masks, effects, and dependencies.

## Animation quality

- Use appropriate interpolation and easing for the intended motion.
- Avoid unnecessary keyframes.
- Prefer readable, maintainable animation setups.
- Preserve timing and visual intent when editing existing animations.

## Safety

- Validate changes before applying them.
- Explain significant trade-offs.
- Ask before destructive or broad changes.
- Never silently overwrite complex existing animation logic.

## Decision rule

When multiple implementations can achieve the same result, choose the simplest
maintainable solution that follows these principles and fits the existing project.

## Adobe-specific recommendations (AE MCP)

- Author explicit motion as keyframes on the Transform properties (Position, Scale, Rotation, Opacity). Only reach for expressions when the motion is procedural, data-driven, or derived from other values.
- Default to Easy Ease (F9) for organic landings; use hold interpolation for value jumps (e.g. visibility toggles); set spatial and temporal interpolation deliberately on path animation (Beziér vs Linear) based on intent.
- Keep expressions readable: reference layers by meaningful name (`thisComp.layer("Camera").transform.position`), avoid magic numbers tied to time, and name the loop strategy (`loopOut("cycle")`/`loopOut("pingpong")`) so intent is visible.
- Centralize tunable values in a controller null with a Slider Control instead of scattering magic numbers across many layers.
- Before changing parenting, check whether the child already carries its own transform keyframes; parenting composes on top and moved parents move children.
- Prefer uniform Scale values unless the effect explicitly needs non-uniform scaling.
- For path animation, prefer roving keyframes (smooth speed) and Auto-Orient as appropriate rather than hand-tuning every key's speed.
- Before replacing an expression or keyframe set, read what it currently does (via the bridge property/expression read ops) and state the trade-off in the result.
- Don't flip per-layer motion blur without checking the comp's render settings.
- Every keyframe edit is undoable through the op that applies it; full-project destructive operations are covered by the incremental-save guard. Match the level of safety to the scope: ask before broad changes, just do reversible per-property ones that are clearly in scope.
