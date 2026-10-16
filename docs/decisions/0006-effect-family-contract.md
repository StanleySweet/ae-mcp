# ADR-0006: effect.* family addresses a layer index and an effect name

Date: 2026-10-16
Status: Accepted
Authors: Stan
References: issue #173; https://ae-scripting.docsforadobe.dev/property/propertygroup/#propertygroupaddproperty ; https://ae-scripting.docsforadobe.dev/property/propertybase/#propertybaseremove ; https://ae-scripting.docsforadobe.dev/general/application/#appeffects

## Context

The `effect.*` operations were broken in three ways (issue #173):

- every handler hard-coded `comp.layer(1)`, so an effect could only ever be read
  or written on the first layer;
- `effect.apply` set the value of a property named in the request instead of
  adding an effect, and `effect.remove` set a keyframe's value to `null` rather
  than removing anything — neither touched the effect parade;
- `effect.list_on_layer` and `effect.list_available` read made-up properties
  (`prop.list_on_layer()`, the layer's own parade) that do not exist.

`effect.apply_template` was a no-op stub that returned `{ success: true }`
without changing the project.

Fixing the internals already forces a change to the exposed argument shape:
once a handler can target any layer and any effect, the request has to say
*which* layer and *which* effect. Since `effect.*` is part of the public
`ae_do`/`ae_catalog` contract, the shape has to be agreed before it lands
(AGENTS: the exposed API contract is ask-first).

## Decision

Every `effect.*` operation takes a layer `index` (default `1`) and names the
effect with `effect` (the localized display name or the stable match name):

| operation                 | args                                                   | behaviour |
| ------------------------- | ------------------------------------------------------ | --------- |
| `effect.apply`            | `{ comp, index?, effect }`                             | `ADBE Effect Parade.addProperty(effect)`; adds regardless of an existing effect (apply = add) |
| `effect.list_on_layer`    | `{ comp, index? }` (read-only)                         | list the layer's parade as `{index,name,matchName,enabled}` |
| `effect.list_available`   | `{}` (read-only)                                       | list `app.effects` as `{name,matchName,category}` |
| `effect.set_property`     | `{ comp, index?, effect, property, value }`            | resolve the effect on the parade, then set its property |
| `effect.set_keyframe`     | `{ comp, index?, effect, property, time, value }`      | same, `setValueAtTime` |
| `effect.remove`           | `{ comp, index?, effect }` (destructive)               | resolve the effect on the parade and `PropertyBase.remove()` it |

An effect is resolved by display name **or** match name, mirroring the
match-name rule (BACKLOG §2 rule 11): name follows the AE UI language, match
name does not. Nested property paths inside an effect go through the existing
`aemcpResolveProperty`, so display names, match names and `/`-paths all work.

`effect.apply_template` is removed: adding an effect is `effect.apply`, and a
`.ffx` template is already covered by `preset.apply_ffx`. A permanent stub that
reports success while doing nothing is worse than no operation — callers cannot
tell it failed.

## Consequences

- Breaking change to six operations. Callers that addressed layer 1 with
  `property` are updated to `effect` + optional `index`. The catalog is the
  contract; `ae_catalog` advertises the new schema immediately.
- The handlers reuse the working `ADBE Effect Parade` + `addProperty` pattern
  already proven in `bulk.apply_effect`, and `PropertyBase.remove` for removal.
- `effect.list_available` no longer takes `comp`; the argument list runs against
  `app.effects`, which is project-independent.
- `apply_template` disappears from the bridge, the registry and `BRIDGE_OPS`.

## Alternatives considered

- **Keep the old argument names and only fix the internals.** Impossible: layer
  targeting and effect identification are new information the old shape cannot
  carry.
- **Address effects by their parade position (`effectIndex`).** Rejected: a
  position shifts whenever any earlier effect is added or removed, and it does
  not survive a re-run; a name/match name is stable.
- **Keep `effect.apply_template` and implement it.** Rejected as speculative:
  no caller needs it, and `.ffx` presets already have `preset.apply_ffx`.
- **`effect.apply` skips when the effect already exists (like
  `bulk.apply_effect`).** Rejected: `apply` means add; callers that want
  idempotence can read `effect.list_on_layer` first.

## Verification

`packages/bridge/src/e6-handlers.test.ts` `effect.*` suite drives apply →
list_on_layer → set_property → set_keyframe → remove against the mock, asserting
the effect lands on the chosen layer index, that `addProperty` was called,
that the removed effect is gone, and that `list_available` reports the mock
`app.effects`. `npm run check` is green.
