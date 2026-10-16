# Finding: an unknown match name in `addProperty` crashes AE 26.5

Date: 2026-10-16
Area: `packages/bridge` (`shape.add`, `shape.set`, every `PropertyGroup.addProperty`)
Related: [`2026-10-16-localized-property-names.md`](2026-10-16-localized-property-names.md)

## Symptom

`ae_do shape.add` with `type: "path"` hung the bridge (client `TIMEOUT`) and took
After Effects down, twice: once inside a `batch.run` from Claude Desktop, once alone
from Claude Code against an empty comp. An `ellipse` with a fill on the same layer
worked. The first diagnosis pointed at the ellipse because it was the last op that
returned before the hang. That was wrong: the path op never returned.

Crash report (AE 26.5.0.89, macOS 27.0.1, arm64), main thread:

```
EXC_BAD_ACCESS (SIGABRT)  KERN_INVALID_ADDRESS at 0x188
TDB_StreamBase::GetDisplayName() const
BEEp_MakeUniqueNameForStream(...)
BEE_CmdAddToIndexedStreamGroup(...)
AEGPD_AddStream(...)
Scripting::PropertyGroup::AddProperty(...)
jsOpLocalAssign / jsOpStatements / jsOpIf / jsOpIf   <- `var x = g.addProperty(...)` in an else-if's else
```

## Cause

`shape.add` added the freeform path as `'ADBE Vector Shape - Path'`. That match name
does not exist. The freeform Path item is **`ADBE Vector Shape - Group`**, and its
path value is `ADBE Vector Shape`
([shape layer match names](https://ae-scripting.docsforadobe.dev/matchnames/layer/shapelayer/)).
AE 26.5 does not reject the unknown name. It creates a stream with no display
name, then dereferences null while generating "Path 1". `shape.set` looked up the
same wrong name, which only returned null, so it silently did nothing.

The ExtendScript frames pin the line: two nested `jsOpIf` frames around a local
assignment match the `else` branch of `if rect / else if ellipse / else` in
`shape.add`.

## Rules that follow

- **Never pass an unverified match name to `addProperty`.** In 26.5 a typo
  crashes the host instead of throwing, and the user loses unsaved work.
- The bridge keeps every match name in one table, `AEMCP_MATCH` (`handlers.js`).
  `match-names.test.ts` fails on any `'ADBE …'` literal outside that table and on
  any table value missing from the list copied from the scripting guide.
- Every `addProperty` goes through `aemcpAddProperty(group, matchName)`. It calls
  `canAddProperty` first, so AE validates the name, and aborts with
  `INVALID_ARGS` otherwise. (`effect.apply` keeps its own `canAddProperty`
  check and `{success:false}` contract.)
- AE has no API that lists the children a group accepts. `canAddProperty` is the
  only runtime check.
- The mock's `MockVectorsGroup` throws on an unknown vector match name, so a bad
  name fails in unit tests instead of only on a live AE.

## Still open

- `mask.add` still uses `masks.addProperty('Mask')` and looks the group up by the
  display name `'Masks'`. The scripting guide documents `ADBE Mask Parade` but no
  match name for a mask atom or its path, so the call was left as it was rather
  than changed from memory.

## Update 2026-10-17: mask match names read from live AE (#177)

The open mask item above is resolved. A mask added on fr_FR AE 26.5 and read back
with `ae_layer_info` reported:

| concept | display name (fr_FR) | matchName |
| --- | --- | --- |
| mask group | Masques | `ADBE Mask Parade` (documented) |
| one mask | Masque 1 | `ADBE Mask Atom` |
| mask path | Tracé du masque | `ADBE Mask Shape` |
| feather | Contour progressif du masque | `ADBE Mask Feather` |
| opacity | Opacité de masque | `ADBE Mask Opacity` |
| expansion | Expansion de masque | `ADBE Mask Offset` |

The mask ops now use `AEMCP_MATCH.MASKS` / `MASK_ATOM` / `MASK_SHAPE`, and
`mask.add` goes through `aemcpAddProperty`. When the scripting guide is silent, a
name read back from a running AE counts as verified. `match-names.test.ts` keeps
those names in a separate `READ_FROM_LIVE_AE` list so their origin stays visible.
