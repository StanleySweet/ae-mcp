# Finding: first-party effect parameter match names come from a live probe

Date: 2026-10-17
Area: `packages/bridge` (`handlers-templates.js`, `handlers.js` `AEMCP_MATCH`), `packages/bridge/src/mock-ae.ts`
Related: [`2026-10-16-localized-property-names.md`](2026-10-16-localized-property-names.md), [`2026-10-16-shape-path-matchname-crash.md`](2026-10-16-shape-path-matchname-crash.md), issue #225

## Problem

The scripting guide lists first-party effect match names
(<https://ae-scripting.docsforadobe.dev/matchnames/effects/firstparty/>) but no
parameter match names. Without them the bridge cannot set an effect's
parameters by match name, so `template.transition` could not offer `wipe` and
`look.apply` could only add effects at their defaults.

## How the names were obtained

- Probe: a script run against a fresh untitled project in live After Effects
  26.5, UI language fr_FR. For each effect it added the effect through
  `canAddProperty` then `addProperty` on the layer's Effect Parade, then
  enumerated the effect's properties, recording `matchName`, the display `name`
  and, per parameter, `index`, `name`, `matchName` and `valueType`.
- The raw output is kept in `.tmp/effect-params.json` (git-ignored; ExtendScript
  `toSource` format). The probe script itself is not checked in.
- Display names are French (`Pourcentage`, `Rayon`, ...). Only match names are
  used by the bridge, per BACKLOG rule 11.
- Effect names were checked against the guide's first-party page. All nine
  effects below are listed there, so they are in `DOCUMENTED`. Parameter names
  are on no guide page, so they are in `READ_FROM_LIVE_AE`
  (`packages/bridge/src/match-names.test.ts`).
- Not verified: the visual effect of each value. The tuned numbers in the looks
  are starting points chosen by reasoning about each parameter's meaning. They
  have not been seen on live AE. The mock has no rendering.

## Effects and parameters used

Effect match names (first-party page): `ADBE Linear Wipe`, `ADBE Glo2`,
`ADBE Gaussian Blur 2`, `ADBE Noise`, `ADBE Drop Shadow`, `CS Vignette` (display
name `CC Vignette`), `ADBE Tint`, `ADBE Turbulent Displace`,
`ADBE Brightness & Contrast 2`.

| Effect | Parameter match name | Display name (fr_FR) | Meaning | Used by |
|---|---|---|---|---|
| ADBE Linear Wipe | `ADBE Linear Wipe-0001` | Pourcentage | Completion: how much of the layer is wiped away, 0 = none, 100 = all | `template.transition` `wipe` |
| ADBE Glo2 | `ADBE Glo2-0002` | Seuil | Threshold: brightness above which pixels glow | `look.apply` `glow`, `neon` |
| ADBE Glo2 | `ADBE Glo2-0003` | Rayon | Radius of the glow | `glow`, `neon` |
| ADBE Glo2 | `ADBE Glo2-0004` | Intensité | Strength of the glow | `glow`, `neon` |
| ADBE Gaussian Blur 2 | `ADBE Gaussian Blur 2-0001` | Flou | Blurriness (radius) | `look.apply` `soft_blur`, `text.animate` `blur_in` |
| ADBE Noise | `ADBE Noise-0001` | Quantité | Amount of noise | `look.apply` `film_grain`, `vhs` |
| ADBE Drop Shadow | `ADBE Drop Shadow-0002` | Opacité | Shadow opacity | `look.apply` `drop_shadow` |
| ADBE Drop Shadow | `ADBE Drop Shadow-0004` | Distance | Shadow offset | `drop_shadow` |
| ADBE Drop Shadow | `ADBE Drop Shadow-0005` | Lissage | Softness of the shadow edge | `drop_shadow` |
| CS Vignette | `CS Vignette-0001` | Amount | Vignette strength | `look.apply` `vignette`, `cinematic` |
| ADBE Tint | `ADBE Tint-0001` | Foncée | Colour that black maps to | `look.apply` `duotone` |
| ADBE Tint | `ADBE Tint-0002` | Claire | Colour that white maps to | `duotone` |
| ADBE Tint | `ADBE Tint-0003` | Facteur | Amount of tint, 0 to 100 | `duotone` |
| ADBE Turbulent Displace | `ADBE Turbulent Displace-0002` | Quantité | Displacement amount | `look.apply` `vhs`, `chromatic`; `template.logo_reveal` `glitch` |
| ADBE Brightness & Contrast 2 | `ADBE Brightness & Contrast 2-0001` | Luminosité | Brightness | `look.apply` `cinematic` |
| ADBE Brightness & Contrast 2 | `ADBE Brightness & Contrast 2-0002` | Contraste | Contrast | `cinematic` |

Other probed parameters (not used): Glow `Couches`, `Composite original`,
`Mode de fusion`, `Couleurs`; Gaussian Blur `Dimensions de flou`; Noise `Type`,
`Ecrêtage`; Drop Shadow `Couleur`, `Direction`, `Ombre seulement`; CC Vignette
`Angle of View`, `Center`, `Pin Highlights`; Turbulent Displace `Balayage`,
`Taille`, `Complexité`, `Evolution`; Tint `Map` (`ADBE Tint-0004`, not used).

Probe notes:
- `ADBE Hue Saturation` reported `available: false` on this build; it is not used.
- Every effect also has a `ADBE Effect Built In Params` group ("Options de
  composition"). The bridge does not touch it.

## Rule for future use

Only match names present in the probe output may be used for effect
parameters. Add each one to `AEMCP_MATCH` in `handlers.js`, to
`READ_FROM_LIVE_AE` in `match-names.test.ts`, and to the mock table
`MOCK_EFFECT_PARAMS` in `mock-ae.ts`. Effect names that are on the first-party
page go to `DOCUMENTED`.
