# "ADBE Advanced 3d" is the Classic 3D renderer; Advanced 3D is "ADBE Calder"

**Rule.** To use the Advanced 3D renderer (extrusion, bevels), set `comp.renderer = "ADBE Calder"`.
`"ADBE Advanced 3d"` is the Classic 3D renderer despite its name. On Classic 3D the geometry options
(`ADBE Extrsn Options Group`) are listed but hidden: setting them fails with "la propriété ou une
propriété parent est masquée".

On Advanced 3D, some material properties stay hidden too: `ADBE Transparency Coefficient`,
`ADBE Index of Refraction`, `ADBE Reflection Coefficient` and `ADBE Light Transmission` refuse
`setValue`. Extrusion depth, bevel style and depth, specular, shininess, metal and opacity work.
Fake glass with layer opacity, a dark fill and coloured point lights.

## Evidence

- AE 26.5.0.89, fr_FR, 2026-10-18. `comp.renderers` = `ADBE Advanced 3d`, `ADBE Calder`, `ADBE Ernst`.
- Extrusion depth failed under `ADBE Advanced 3d` and succeeded under `ADBE Calder` on the same layer.
- The crash report of 2026-10-18 10:50 loads `Calder.plugin`; the Advanced 3D render threads are
  named `rte_*` in that plugin.
- The scripting guide does not map the renderer match names to UI names.
