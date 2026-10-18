# Environment light with a layer source can crash AE 26.5 (render-hash recursion)

**Rule.** Do not give an environment light (`LightType.ENVIRONMENT`) a `lightSource` layer in a comp
that uses the Advanced 3D renderer until the setup has been proven safe on AE 26.5. Treat
`layer.add_light {lightType: "environment", lightSource}` as crash-prone: render nothing in that
comp after creating it, and prefer an environment light without a source layer.

## Evidence

- 2026-10-18 10:50, AE 26.5.0.89 (macOS 27.0.1, M1): crash `EXC_BAD_ACCESS (SIGILL)`, stack guard hit
  on thread "BEE WorkQueue General Render Thread".
- Report: `~/Library/Logs/DiagnosticReports/After Effects-2026-10-18-105201.ips`.
- The stack is a 2,439-level recursion:
  `BEE_LightLayer::GetRenderGuidWithRO` → `BEE_CompItem::MixInGuidForLights` →
  `BEE_AVLayer::MixInGuidForTransformNonRecursive` → `BEE_AVLayer::GetRenderGuidWithRO` →
  `BEE_LightLayer::GetRenderGuidWithRO` … starting from `BEE_MaterialOverrideLayer::GetRenderGuidWithRO`.
- Setup at the time (comp "GF Glass Pellet", renderer `ADBE Advanced 3d`): a 2D precomp layer
  "Env Map", an environment light "Env Light" with `lightSource` = "Env Map", a 3D shape layer
  "Glass". AE accepted the assignment (the source was 2D, as the scripting guide requires).
- Reading: hashing the light hashes its source layer; hashing that layer's transform mixes in the
  comp's lights, which include the same light. AE never breaks the cycle and overflows the stack.
  This is an AE defect, not a script error, so the bridge cannot catch it with try/catch.

## Not verified

- Whether turning the source layer's video off (`enabled = false`), or putting the source in
  another comp, avoids the cycle.
- Whether the Classic 3D renderer is affected.
