# A blur on a solid that fills its layer looks like a stale render

**Rule.** To check that an effect change renders, put the effect on a small shape layer (an
ellipse well inside the comp), not on a solid. Gaussian Blur on a solid that fills its own
layer changes almost no pixels, so before and after frames compare as equal and look stale.
`ae_render_frame` does not serve cached frames after an effect change; do not purge caches
to "fix" it (a purge also throws away the user's RAM preview).

## Evidence

- AE 26.5.0.89, 2026-10-18, comp 400×400. White solid scaled to 40%, Gaussian Blur 0 then 40:
  `changedPercent` 0, the alpha channel identical too, also at a frame never rendered before.
- Same comp, red 120 px ellipse shape layer, Gaussian Blur set to 30: `changedPercent` 2.16
  on the next render, no transform touched.
- #281 reported the stale frame from the same kind of solid; the purge added for it was reverted.
