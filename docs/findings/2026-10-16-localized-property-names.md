# Finding: AE property display names are localized; match names are not

Date: 2026-10-16
Area: `packages/bridge` (every `layer.property(...)` / group lookup)
Related: [`2026-10-15-localized-ae-prefs-filename.md`](2026-10-15-localized-ae-prefs-filename.md)

## Symptom

While building a title animation against this Mac's **fr_FR After Effects 26.5**,
`ae_layer_info` reported the transform group and its properties in French:

```json
{"name":"Transformer","matchName":"ADBE Transform Group","properties":[
  {"name":"Point d'ancrage","matchName":"ADBE Anchor Point"},
  {"name":"Position","matchName":"ADBE Position"},
  {"name":"Echelle","matchName":"ADBE Scale"},
  {"name":"Opacité","matchName":"ADBE Opacity"}]}
```

A property path written with an English *display* name (`Transform/Opacity`) would
not resolve here; the same path with match names (`ADBE Transform Group/ADBE
Opacity`) does.

## Cause

AE exposes every property twice: a display `name`, localized to the UI language,
and a `matchName`, which is stable across locales and releases. Any lookup that
hardcodes a display name works only in the locale it was written against.

Observed live on fr_FR AE 26.5:

| concept | display name | matchName |
| --- | --- | --- |
| transform group | Transformer | `ADBE Transform Group` |
| Position | Position | `ADBE Position` |
| Scale | Echelle | `ADBE Scale` |
| Opacity | Opacité | `ADBE Opacity` |
| Anchor Point | Point d'ancrage | `ADBE Anchor Point` |
| Rotation | Rotation | `ADBE Rotate Z` |

Note that the *English* display names happen to resolve on this fr_FR install —
`text.add` calls `textLayer.property('Source Text')` and applied the font size
correctly — so the bridge's existing English display-name lookups
(`property('Source Text')`, `property('Contents')`, `property('Marker')` in
`handlers.js`) do not fail today. That is AE being lenient, not a contract: a
French display name would never resolve on an English install, and AE is free to
rename a display string in any release.

## The resolver already supports match names

`aemcpResolveProperty(group, path)` (handlers.js) splits a `/`-separated path and,
failing that, walks the group tree comparing each child's `name` **and**
`matchName`. So a single match name (`ADBE Opacity`) resolves at any depth, and a
full path (`ADBE Transform Group/ADBE Scale`) is deterministic.

## Rule

BACKLOG §2 rule 11: address properties, groups and effects by match name. AGENTS.md
"Other rules" points here. In bridge code prefer:

```js
var opacity = layer.property('ADBE Opacity');
```

over any capitalized display-name string.

## Takeaway

New AE lookups are match-name first. Before trusting a `property('…')` call on a
non-English install, grep the call for a display-style capitalized name; the safest
identifier is always the `matchName` from the scripting guide.
