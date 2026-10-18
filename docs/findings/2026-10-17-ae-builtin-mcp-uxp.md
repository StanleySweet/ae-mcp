# Spike notes: After Effects built-in MCP server (UXP)

Date: 2026-10-17
Issue: #249
Status: desk research only. No prototype was built and no AE 26.5 beta run was done.

## Question

The issue premise: After Effects 26.5 ships an MCP server, behind a beta flag, that
UXP extensions can extend, with native render and annotation tools. Could ae-mcp
register one of its tools through that server instead of doing the work itself?

## What was checked

- `https://developer.adobe.com/after-effects/uxp/` (WebFetch, 2026-10-17). The page
  is the After Effects UXP landing page. It says the resources will keep expanding
  "throughout the beta". It lists the After Effects API sections as: Application,
  Project items, Layers, Properties, File sources, Fonts, Import options and
  Settings. Shared UXP sections are file system, networking, storage, HTML, CSS and
  Spectrum UI. It does not mention MCP, a built-in MCP server, tool registration or
  a 26.5 beta flag.
- `https://developer.adobe.com/after-effects/` (WebFetch). The fetch returned a
  truncated placeholder. Nothing could be read from it.
- One web search, "After Effects 26.5 built-in MCP server UXP extension beta flag".
  It found no Adobe page for a built-in MCP server or a UXP tool-registration API.
  Results were third-party projects only: kumoproductions/mcp-aftereffects (says it
  was verified on AE 26.5 for dialog handling, unofficial), ishu86/after-effects-mcp
  (CEP), TheLlamainator/after-effects-mcp (panel, needs script file writes enabled),
  and Flexile's bundled extension (beta, AE 2025+).

## What could not be found

- No Adobe documentation for a built-in MCP server in After Effects. Not in the UXP
  landing page, not in the search results.
- No UXP API for registering a tool with that server (no method names, manifest
  fields or permissions).
- No name or preference for the 26.5 beta flag that enables it.
- No description of its native render or annotation tools, so no way to judge
  their overlap with `ae_render`, `ae_render_frame` or `ae_dialogs`.
- Nothing about its transport (stdio, HTTP, or in-app socket) or how it would reach
  the bridge's file queue.
- The After Effects beta forum and 26.5 release notes were not searched. Those are
  the likeliest places for the missing details.

## Implications for ae-mcp (unverified)

- The current server's public tools must not change (#249 AC). Any spike has to be a
  separate extension that adds one tool, not a change to `packages/server`.
- The existing bridge (ExtendScript over the file queue) would stay in place. A UXP
  route would be a second execution path, so it needs its own safety review (undo,
  destructive guard, ADR-0009 no scripted undo).
- Until the API and the beta flag are confirmed on a real 26.5 build, the spike
  cannot produce a working prototype. This needs a human with that build.

## Next steps (human)

1. On an AE 26.5 beta build, find the flag and the built-in MCP server's endpoint.
2. Record the registration API from the beta SDK or sample code, then update this file.
3. Build the single-tool prototype under `.tmp/` (not in the repo) and run it once.
4. Record the outcome and close the go/no-go decision in the ADR draft
   `docs/decisions/0010-ae-builtin-mcp-uxp.md`.

## Update 2026-10-18: what the AE Beta 27.1 binaries and a live launch show

Status: the built-in server exists and runs in the beta. Read from `strings` on
`MCP Server.plugin` and `dvamcp.framework` in `Adobe After Effects (Beta).app` (27.1.0,
`com.adobe.AfterEffectsBeta.application`), plus one launch of the beta. Not yet called
with a valid token.

**Rule.** The built-in server speaks MCP over streamable HTTP on loopback and needs a
bearer token that changes at every launch. A client cannot reach it without first reading
the token from inside After Effects (UXP `getAssistantPreferences`).

- Two servers. The "AI Assistant" server on path `aftereffects/assistant/mcp` prefers port
  4111 and falls back to an OS port; the general server on `aftereffects/mcp` uses the
  preferences port. On launch the beta listened on `127.0.0.1:4111` and `[::1]:4111`.
- Unauthenticated `initialize` on both paths returns `401 Unauthorized`
  ("Bearer token authentication required for MCP connections").
- Gate: the log string "MCP servers disabled by BetaFeature gate". AE 26.5 ships the same
  plug-in but stays gated; the beta runs it.
- Preferences object: `{enabled, authenticationMode, port, server, path, accessToken}`,
  read with `getPreferences` / `getAssistantPreferences`, written with `setPreferences`.
- UXP extension API (scripting objects `MCPScriptingExtensibilityAPIObject`, `MCPEvent`):
  an extension receives `MCPEvent.MCPMethodCalled` for `tools/list`, `tools/call`,
  `resources/*`, `prompts/*`, and answers with `MCP.postMCPResponse(contextGuid,
  responseJSON)` or `postMCPError`. "Signals that the UXP extension has (re)loaded and
  tools should be re-queried" and `EVENT_TOOLS_ADDED` cover tool registration.
  `listNativeTools` and `setNativeToolEnabled` toggle the native tools.
- Native tools: `RenderFrameTool`, `AnnotationTool` (strokes classified as dot, arrow,
  closed-region, with `centroid` and `tip` to pick a layer), `InspectMediaTool`,
  `VectorizeImageTool`, plus "agentic skills" resources (bundled and personal skills
  directory) and an assistant workflow that asks before saving a new project.
- Undo: `beginInitiatorTagging` / `endInitiatorTagging` claim undo grouping ids per agent
  tool call, so agent edits show up as named undo groups.

### Next steps

1. Find where the beta shows the token or a client config (Preferences, AI Assistant panel).
2. With the token, list the native tools and their schemas; record them here.
3. Prototype: a UXP extension that answers `tools/list` and `tools/call` for one ae-mcp
   operation through `postMCPResponse`. Then write the go/no-go ADR.
