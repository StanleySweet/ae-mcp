# Bundle

Assets and build inputs for the Claude Desktop extension (`.mcpb`).

- `manifest.json` — mcpb spec `0.3` manifest (name, version, author, icon, node server entry).
- `icon.png` — 128×128 extension icon.
- `pack.ts` — `npm run bundle:pack` builds `packages/server/src/index.ts` into a single
  `server/index.js` (esbuild inlines every dependency), copies the manifest and icon, and
  zips them into `bundle/out/ae-mcp.mcpb`. The zip root holds `manifest.json`, `icon.png`
  and `server/index.js`, matching `manifest.json`'s `entry_point` and `mcp_config`.
- `smoke.ts` — `npm run bundle:smoke` packs the bundle, unpacks the `.mcpb`, starts its
  `server/index.js` with `AE_MCP_ROOT` pointed at a running fake bridge, and checks the
  server lists its tools over MCP stdio.
