# After Effects for Claude: Product Owner Backlog

Version 1.1 · 2026-10-09 · Owner: you · Status: ready for Sprint 0

## 1. Product

**Vision.** Claude Desktop can see and edit the After Effects project the user has open, so repetitive AE work gets faster. After a one-window install the pipeline needs no routine upkeep, and failures diagnose themselves in chat.

**Users.** The owner and one partner. macOS only. After Effects 2025 and later (any year found in `/Applications`).

**Goals**

- Install in under 5 minutes: one app window, one admin password, one Claude install click.
- Feature parity with the public AE MCPs (catalog in section 8) behind a small tool surface.
- Every call is one undo step. Bulk edits can preview before applying.
- A new AE release works without code changes.

**Non-goals** (icebox): Windows (not planned, so no Windows code paths), a UXP bridge, Apple notarization, recipes and templates, telemetry.

**Success metrics:** fresh-Mac install takes 5 minutes or less; the manual checklist (section 9) passes on real AE; `check_setup` names the cause of every injected failure.

## 2. Rules for the executing LLM

1. One task = one commit. Never combine tasks. Never start a task whose dependencies are not merged.
2. Before coding, read the task, its story's acceptance criteria (AC) and any referenced ADR.
3. Write the test first when the behavior is testable. The commit holds test and code together and passes `npm run check`.
4. Use the commit message given in the task, exactly (Conventional Commits). Add a body only to record a decision.
5. Never use an After Effects API from memory. Look it up in the [AE scripting guide](https://ae-scripting.docsforadobe.dev) and cite the page in a code comment. If unsure, add the question to `docs/QUESTIONS.md` and stop.
6. Tasks tagged `[HUMAN]` need a real AE. Produce the script and instructions, then stop until results are committed under `docs/`.
7. Tasks tagged `[GATE]` must not start until the named ADR has status Accepted.
8. Bridge code (`packages/bridge`) is ExtendScript ES3: `var` only; no arrow functions, template strings, `let`/`const`, trailing commas, and no native `JSON`, `forEach`, `map`, `filter` or `indexOf` (use the polyfills from E3-1).
9. Runtime dependencies are limited to `@modelcontextprotocol/sdk` and zod. Adding another needs an ADR.
10. A change to public behavior updates `docs/` in the same commit. Code targets macOS only: no Windows paths and no cross-platform abstractions.

## 3. Definitions

**Definition of Ready (story):** has AC, dependencies merged, any `[GATE]` cleared.

**Definition of Done (task):** `npm run check` is green (lint, typecheck, unit tests, ES3 lint, build); tests added; no TODO without an issue ID; docs updated; commit message matches; CI green on the PR.

**Definition of Done (sprint):** every task meets its DoD; the parts of the manual checklist flagged for that sprint pass on real AE; a tagged prerelease builds in CI.

## 4. Architecture (fixed unless an ADR changes it)

```
Claude Desktop
  | stdio
MCP server (.mcpb, Node)
  | Transport interface: FileQueue or osascript (chosen by ADR 0001)
Loader (AE Scripts/Startup) -> Payload (~/.ae-mcp/bridge/current.jsx)
  |
After Effects (+ aerender for headless renders)

Setup.app (Electron) installs and repairs everything through packages/core.
```

**Repo layout**

- `packages/protocol`: zod schemas, `PROTOCOL_VERSION`, error codes
- `packages/core`: AE discovery, installers, prefs, paths (shared by server and Setup.app)
- `packages/server`: MCP tools, policy, transports
- `packages/bridge`: ES3 loader and payload, built into `dist/`
- `packages/fake-bridge`: in-memory AE for tests
- `apps/installer`: Electron Setup.app
- `bundle/`: mcpb manifest and assets
- `docs/`: decisions/, QUESTIONS.md, user guide
- `.github/`: workflows

**Protocol rules**

- Every message carries `protocolVersion`.
- Heartbeat reports `{bridgeVersion, aeVersion, os, capabilities[], busy, transport}`.
- Job: `{id, tool, args, deadline}`. Result: `{ok, result}` or `{ok:false, error:{code, message, hint}}`.
- Writes are atomic (temp file, then rename).
- One consumer. Jobs are serialized. Each runs in an undo group named `'Claude: <tool>'`.
- Queue directory `~/.ae-mcp` is chmod 700.
- Long jobs return a `jobId` and are polled with `job_status`.

## 5. Roadmap

| Sprint | Epics                                        | Outcome                                                              |
| ------ | -------------------------------------------- | -------------------------------------------------------------------- |
| S0     | E0                                           | Repo, tooling, CI green                                              |
| S1     | E1                                           | Spike: transport ADR and third-party tools ADR (needs real AE)       |
| S2     | E2, E3                                       | Protocol, fake bridge, bridge runtime                                |
| S3     | E4, E5a                                      | Server core, check_setup, first observe tools                        |
| S4     | E5b, E6a                                     | Observe complete, operation registry                                 |
| S5     | E6b, E7, E8, E13                             | All parity ops, safety, checkpoint, render, incremental-save guard. MVP: usable by hand |
| S6     | E9, E10a, E14                                | Bulk edit tools, installer core logic, Mister Horse and Mt. Mograph support |
| S7     | E10b, E11, E12                               | Installer UI, release pipeline, docs. v1.0                           |

## 6. Backlog

### E0 Foundation (Sprint 0)

**Story 0.1.** As a developer, I can clone, install and run all checks with two commands. AC: `npm ci && npm run check` passes on a clean clone on macOS and Linux.

- **E0-1** chore: init npm workspaces monorepo: root package.json, .nvmrc (24), .gitignore, .editorconfig, MIT LICENSE, README stub, empty package folders.
- **E0-2** chore: add typescript base config and project references
- **E0-3** chore: add eslint, prettier and vitest with check script: scripts lint, typecheck, test, check.
- **E0-4** chore: add commitlint and lefthook: enforce Conventional Commits locally.
- **E0-5** ci: add ci workflow: the file from section 7.1.
- **E0-6** docs: add contributing guide, ADR template and QUESTIONS.md

### E1 Transport spike (Sprint 1, needs a real AE)

**Story 1.1.** As the owner, I know which transport works reliably on my Mac. AC: `docs/decisions/0001-transport.md` is Accepted and holds measured results for transport A (Startup loader polling with `scheduleTask`) and transport B (osascript `DoScriptFile` per call).

Questions the spike must answer:

1. Is Scripts/Startup writable without admin rights?
2. Does a Startup script keep polling with no panel open?
3. Does polling cause the 'second script' warning when a user script runs?
4. Does editing AE's prefs file to allow scripts to write files persist?
5. Does cold-launching AE work, and after what?
6. What are latency and failure rate over 100 round trips?

- **E1-1** feat(spike): transport A startup loader polling an inbox
- **E1-2** feat(spike): transport B osascript dispatcher
- **E1-3** feat(spike): benchmark harness for 100 round trips
- **E1-4** docs(spike): run instructions and results template
- **E1-5** [HUMAN] Run on both Macs, fill the template, then commit `docs(adr): 0001 transport decision`.

Default if both work: prefer A, fall back to B, and report the active one in `check_setup`.

### E2 Protocol and fake bridge (Sprint 2)

**Story 2.1.** As a developer, I can test the whole MCP layer without After Effects. AC: a contract suite passes against the fake bridge; malformed messages are rejected with typed errors.

- **E2-1** feat(protocol): job, result and heartbeat schemas with PROTOCOL_VERSION
- **E2-2** feat(protocol): error codes with hints
- **E2-3** feat(protocol): queue layout and atomic write helper
- **E2-4** feat(fake-bridge): queue consumer with in-memory project model
- **E2-5** test(protocol): reusable contract suite for any bridge implementation

### E3 Bridge runtime (Sprint 2)

**Story 3.1.** As a user, the bridge starts with AE and runs jobs safely. AC: bridge logic passes unit tests in Node against a mock AE object; ES3 lint passes; each job is one undo group and always writes a result.

- **E3-1** feat(bridge): es3 polyfills and json2
- **E3-2** build(bridge): concatenate sources into loader.jsx and payload.jsx with version stamp (plain concatenation, no transpiler)
- **E3-3** ci(bridge): es3 syntax lint
- **E3-4** test(bridge): mock AE object and vm test harness
- **E3-5** [GATE ADR 0001] feat(bridge): loader with heartbeat and payload reload on version change
- **E3-6** feat(bridge): job runner with undo group, error capture and result write
- **E3-7** feat(bridge): handler registry and capabilities in heartbeat
- **E3-8** feat(bridge): busy flag and chunked execution for long jobs

### E4 Server core (Sprint 3)

**Story 4.1.** As Claude, I can reach AE and learn what is wrong when I cannot. AC: against the fake bridge: results correlate by id; a timeout returns an error with a hint; stale files are purged; `check_setup` returns `[{check, status, fix}]` for each injected failure.

- **E4-1** feat(server): mcp server skeleton over stdio
- **E4-2** feat(server): transport interface and file queue transport
- **E4-3** [GATE ADR 0001] feat(server): osascript transport and automatic selection
- **E4-4** feat(server): callAE with timeout, id correlation and stale purge
- **E4-5** feat(core): discover installed AE versions 2025 and later
- **E4-6** feat(server): check_setup tool
- **E4-7** feat(server): ae_context tool
- **E4-8** feat(server): stall detection: stale heartbeat while busy reports a dialog
- **E4-9** feat(server): launch AE and wait for heartbeat

### E5 Observe (Sprints 3 and 4)

**Story 5.1.** As Claude, I can read the project cheaply and precisely. AC: each tool accepts batched input, returns compact JSON matching the fake-bridge fixtures, and flags truncation when output exceeds the size cap.

- **E5-1** feat(bridge): serializers for items and comps
- **E5-2** feat(bridge): layer serializer with property tree, keyframes, effects, masks and text
- **E5-3** feat(server): ae_project_info
- **E5-4** feat(server): ae_comp_info with array input
- **E5-5** feat(server): ae_layer_info with index, array or all
- **E5-6** feat(server): ae_version_info with capability probe
- **E5-7** feat(server): get_selection
- **E5-8** feat(server): find for layers, comps and properties

### E6 Operation registry and parity operations (Sprints 4 and 5)

**Story 6.1.** As Claude, I discover and run operations through `ae_catalog` and `ae_do`. AC: arguments are validated against the schema before reaching AE; every response carries ambient context (active comp, selection); `batch.run` is a single undo step; an unknown operation returns the closest names.

- **E6-1** feat(protocol): operation definition type with name, category, schema and readOnly
- **E6-2** feat(server): ae_catalog
- **E6-3** feat(server): ae_do with validation and ambient context
- **E6-4** feat(bridge): batch.run in one undo group

**Story 6.2.** As Claude, I can perform every operation listed in section 8. AC: each operation has a bridge handler, a fake-bridge handler, a schema, a unit test and a line in the manual checklist.

Tasks E6-5 to E6-15 are one commit per category, each with the message `feat(ops): <category> operations`:

| Task   | Category                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| E6-5   | project                                                                                                    |
| E6-6   | comp                                                                                                       |
| E6-7   | layer                                                                                                      |
| E6-8   | property and keyframe                                                                                       |
| E6-9   | expression                                                                                                 |
| E6-10  | effect                                                                                                     |
| E6-11  | preset                                                                                                     |
| E6-12  | marker                                                                                                     |
| E6-13  | mask, shape and text                                                                                       |
| E6-14  | audio (WAV analysis runs in the Node server, markers are written through the bridge)                       |
| E6-15  | font and command                                                                                           |

### E7 Safety and checkpoint (Sprint 5)

**Story 7.1.** As the owner, I control what Claude may do. AC: read-only mode blocks every mutating operation, including inside `batch.run`; `ae_catalog` lists only permitted operations; `eval.run` does not exist unless enabled; settings live in `~/.ae-mcp/settings.json` and environment variables override them.

- **E7-1** feat(server): settings loader
- **E7-2** feat(server): policy engine for read-only and category allowlist
- **E7-3** feat(server): gate eval.run behind a setting
- **E7-4** feat(server): require an incremental save before save-over and file overwrite (guard defined in E13)

**Story 7.2.** As the owner, I can snapshot and restore a project. AC: export then import with clearFirst reproduces the structure in a fixture comparison; dryRun reports counts and changes nothing.

- **E7-5** feat(ops): project export to json
- **E7-6** feat(ops): project import from json with dryRun and clearFirst
- **E7-7** feat(server): ae_save_project

### E8 Render and visual feedback (Sprint 5)

**Story 8.1.** As Claude, I can see my own work and run renders without blocking. AC: `render_frame` returns a PNG as image content; if direct frame saving is unavailable it falls back to the render queue and aerender; long renders run as async jobs polled with `job_status` and can be cancelled.

- **E8-1** feat(ops): render.frame with capability probe and fallback
- **E8-2** feat(server): ae_render_frame returning image content
- **E8-3** feat(ops): render queue operations for add, template, output path and status
- **E8-4** feat(core): aerender discovery and runner with progress parsing
- **E8-5** feat(server): job store and job_status tool
- **E8-6** feat(server): cancel job and clean up partial output

### E9 Bulk edit and project hygiene (Sprint 6)

**Story 9.1.** As the owner, I can change many layers or comps in one request and preview first. AC: every bulk tool defaults to dryRun and returns `{planId, changes[]}`; applying a planId runs in one undo group; a plan expires after 10 minutes or when the project changed since it was made.

- **E9-1** feat(server): plan store with expiry and project change check
- **E9-2** feat(ops): bulk rename by pattern, regex and numbering
- **E9-3** feat(ops): bulk set property across layers or comps
- **E9-4** feat(ops): bulk apply effect, expression or preset to a selection
- **E9-5** feat(ops): replace text across text layers and comps
- **E9-6** feat(ops): stagger layers or keyframes by an offset (fixed or proportional offset)
- **E9-7** feat(ops): bulk label and color

**Story 9.2.** As the owner, I can clean up and repurpose projects. AC: each tool is plan/apply and covered by fake-bridge tests.

- **E9-8** feat(ops): report unused items and missing footage
- **E9-9** feat(ops): remove unused items (plan and apply)
- **E9-10** feat(ops): duplicate comp with new name and size
- **E9-11** feat(ops): organize items into project folders
- **E9-12** feat(ops): batch resize a comp into several formats

### E10 Setup app (Sprints 6 and 7)

**Story 10.1.** As a user, the install logic is safe to run repeatedly. AC: every step is idempotent, reports `{check, status, fix}`, and is tested against a temporary fake `/Applications` and home directory.

- **E10-1** feat(core): detect AE installs and Claude Desktop
- **E10-2** feat(core): install payload into ~/.ae-mcp/bridge
- **E10-3** feat(core): install loader into Scripts/Startup with admin elevation and manual fallback text
- **E10-4** [GATE ADR 0001] feat(core): enable scripting preference while AE is closed, with backup and verification
- **E10-5** feat(core): hand the bundled mcpb to Claude Desktop for install
- **E10-6** feat(core): live test that launches AE, waits for heartbeat, creates and deletes a test comp
- **E10-7** feat(core): repair and uninstall functions

**Story 10.2.** As a user, one window does everything. AC: the window shows the checklist from the mockup (AE found, Claude found, bridge, permission, extension, test); Install runs all steps with live progress; reopening shows state with a Fix button per failed row; asks the user to quit AE when the prefs step needs it.

- **E10-8** feat(installer): electron skeleton with typed IPC to packages/core
- **E10-9** feat(installer): checklist window
- **E10-10** feat(installer): install flow with progress
- **E10-11** feat(installer): repair mode with per-row fix
- **E10-12** feat(installer): quit-AE prompt and retry
- **E10-13** feat(installer): export diagnostics log

### E11 Packaging and release (Sprint 7)

**Story 11.1.** As the owner, pushing a tag produces both artifacts. AC: a v* tag creates a GitHub Release holding the .mcpb, the Setup app for Apple Silicon and Intel, and a SHA-256 checksum file.

- **E11-1** build(bundle): mcpb manifest and icon
- **E11-2** build(bundle): bundle:pack script
- **E11-3** test(bundle): bundle:smoke starts the packed server against the fake bridge and checks tools/list
- **E11-4** build(installer): electron-builder config for unsigned arm64 and x64 builds that embed the mcpb
- **E11-5** ci: add release workflow: the file from section 7.2.
- **E11-6** chore: add dependabot config with weekly grouped updates
- **E11-7** [HUMAN] Clean-Mac install test using the release artifacts and checklist section 9.
- **E11-8** chore(release): v1.0.0

### E12 Documentation and handoff (Sprint 7)

- **E12-1** docs: user guide with install, first run, and Gatekeeper right-click Open
- **E12-2** docs: troubleshooting keyed to check_setup results
- **E12-3** docs: tested AE versions table
- **E12-4** docs: runbook for a new AE release (run checklist, update table, ship patch)

### E13 Destructive-operation safety (Sprint 5, replaces the confirmation idea in E7-4)

**Rule.** An operation that deletes, replaces or overwrites, or that Cmd+Z cannot reverse, first makes an incremental save of the project. File > Increment and Save turns `MyProject_v007.aep` into `MyProject_v008.aep`, so the file on disk keeps the state from just before the change. One increment per call, per `batch.run` and per bulk plan, never per operation.

**Destructive operations:** every delete or remove operation, clearing or replacing items, `project.import_json` with clearFirst, `project.save_as` onto an existing path, renders or exports onto an existing file, bulk plans that remove or replace, `command.execute`, and `eval.run` (always destructive).

**Story 13.1.** As the owner, I can always return to the state before a destructive change. AC: operations carry a destructive flag in the registry; the guard increments before running and refuses with a hint when the project has never been saved; the result and the next `check_setup` name the new file; the guard cannot be bypassed through `batch.run`, bulk plans or `eval.run`; the setting `incrementBeforeDestructive` is on by default and Claude cannot change it.

- **E13-1** feat(protocol): destructive flag on operation definitions
- **E13-2** feat(ops): project.increment_save using the Increment and Save menu command found by name
- **E13-3** feat(server): destructive guard that increments first and refuses unsaved projects
- **E13-4** feat(server): apply the guard once per batch.run and per bulk plan
- **E13-5** feat(server): report the saved version path in results and check_setup
- **E13-6** test(server): guard cannot be bypassed through batch.run, bulk apply or eval.run
- **E13-7** docs: list destructive operations in the user guide
- **E13-8** [HUMAN] docs(checklist): add rows 14 and 15. Row 14: delete a layer through Claude, then confirm a new `_v###` file exists and still contains the layer. Row 15: an unsaved project is refused with a hint.

### E14 Mister Horse and Mt. Mograph support (spike in Sprint 1, rest in Sprint 6)

**What we know.** Mister Horse (Animation Composer) lives inside After Effects as an extension panel and applies motion presets by drag and drop, with timing controlled by layer markers. Mt. Mograph's Motion is a paid extension with 40+ tools for anchors, easing, delay and expressions. I found no documented scripting API for either, so this epic does not drive their panels. The spike (E14-1, E14-2) confirms that on your machines.

**What support means here:** (1) our bridge coexists with their panels, (2) Claude can read and safely edit what they create, (3) Claude can apply their presets when the files are readable, (4) Claude can do the common Motion actions natively.

**Story 14.1.** As the owner, I know what these tools expose. AC: `docs/decisions/0002-third-party-tools.md` is Accepted and answers: where Animation Composer presets are stored and in what format (for example .ffx or precomps); what a preset leaves on a layer (markers, expressions, effects); whether Motion has any script entry point; whether their panels cause 'second script' collisions with our bridge; what their license terms say about automating or reading their libraries.

- **E14-1** feat(spike): third-party investigation script and results template: lists installed extensions and preset folders, and dumps layers, markers, expressions and effects after a preset is applied by hand.
- **E14-2** [HUMAN] Run on both Macs with each panel open, then commit `docs(adr): 0002 third-party tool support`.

**Story 14.2.** As a user, our bridge works while their panels are open. AC: with each panel open and in use, 100 round trips succeed; collisions are retried with backoff; `check_setup` reports which third-party extensions it detected.

- **E14-3** [GATE ADR 0002] feat(server): retry with backoff when AE reports a script is running
- **E14-4** feat(core): detect installed After Effects extensions and list them in check_setup
- **E14-5** [HUMAN] docs(checklist): add rows 16 and 17 (collision test with each panel; Claude explains a preset-built layer correctly)

**Story 14.3.** As Claude, I can read and safely edit what these tools create. AC: layer info shows markers with comments and durations, expressions, and effects; Claude can list every expression-driven property on a layer or comp; an edit that targets such a property returns a warning naming the driver, so Claude can choose to edit the control instead.

- **E14-6** feat(ops): marker details in layer info
- **E14-7** feat(server): expression_report for a layer or comp
- **E14-8** feat(server): warn when an edit targets an expression-driven or preset-created property

**Story 14.4.** As the owner, Claude can apply my installed presets. AC: shaped by ADR 0002. If the presets are readable files, a library path setting lets Claude search and apply them with in and out timing set by markers; we never copy, modify or redistribute their files. If not readable, this story is closed as unsupported and 14.5 covers the need.

- **E14-9** [GATE ADR 0002] feat(settings): third-party library paths
- **E14-10** [GATE ADR 0002] feat(ops): thirdparty.search over configured libraries
- **E14-11** [GATE ADR 0002] feat(ops): thirdparty.apply_preset with in and out marker timing

**Story 14.5.** As the owner, Claude does the everyday Motion-style actions without the panel. AC: each runs as one operation and one undo step; all code is original, not copied from any vendor.

- **E14-12** feat(ops): ease.preset for selected keyframes (ease in, ease out, overshoot)
- **E14-13** feat(ops): anchor.move_preserving for nine anchor positions
- **E14-14** feat(ops): expression.snippet library (wiggle, loop, delay, overshoot)
- **E14-15** feat(ops): rig.null_controller linking layers to a null with sliders

Delay and stagger reuse E9-6.

## 7. GitHub pipeline

Before implementing, check the current major versions of each action and the exact mcpb CLI commands in their docs, and pin actions to a commit SHA if desired.

### 7.1 .github/workflows/ci.yml (task E0-5)

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  check:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run bridge:lint-es3
      - run: npm run bridge:build
      - run: npm run bundle:pack
      - run: npm run bundle:smoke
      - if: github.event_name == 'pull_request' && matrix.os == 'ubuntu-latest'
        run: npx commitlint --from ${{ github.event.pull_request.base.sha }} --to ${{ github.event.pull_request.head.sha }}
```

The bundle steps are no-ops until E11 adds them; add the scripts as stubs in E0-3 so the workflow is valid from the start.

### 7.2 .github/workflows/release.yml (task E11-5)

```yaml
name: release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  mcpb:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run check
      - run: npm run bundle:pack
      - uses: actions/upload-artifact@v4
        with: { name: mcpb, path: dist/*.mcpb }
  installer:
    needs: mcpb
    runs-on: macos-latest
    env:
      CSC_IDENTITY_AUTO_DISCOVERY: 'false'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - uses: actions/download-artifact@v4
        with: { name: mcpb, path: apps/installer/resources }
      - run: npm run installer:build -- --mac dmg zip --arm64 --x64
      - uses: actions/upload-artifact@v4
        with: { name: installer, path: apps/installer/dist/*.dmg }
  publish:
    needs: [mcpb, installer]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with: { path: artifacts }
      - run: cd artifacts && find . -type f \( -name '*.mcpb' -o -name '*.dmg' \) -exec sha256sum {} + > ../SHA256SUMS.txt
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          files: |
            artifacts/**/*.mcpb
            artifacts/**/*.dmg
            SHA256SUMS.txt
```

### 7.3 Repository settings (one-time, by the owner)

- Protect main: require the ci check, require linear history, no direct pushes.
- Enable Dependabot version updates.
- Releases are cut by pushing a tag: `git tag v1.0.0 && git push --tags`.
- The Setup app is unsigned. First launch on each Mac: right-click, Open. If macOS still blocks it, run `xattr -dr com.apple.quarantine` on the app.

## 8. Operation catalog (parity target)

Sources: kumo = [kumoproductions/mcp-aftereffects](https://github.com/kumoproductions/mcp-aftereffects), llama = [TheLlamainator/after-effects-mcp](https://github.com/TheLlamainator/after-effects-mcp). Operations are named `category.action` and run through `ae_do`.

| Category         | Operations                                                                                                         | Source     |
| ---------------- | ---------------------------------------------------- | ---------- |
| project          | info, save, save_as, export_json, import_json, find_layers, undo, import_footage, create_folder, move_item | kumo |
| comp             | create, info, duplicate, set_settings, precompose, layer_clip_frames | both |
| layer            | add_text, add_shape, add_solid, add_adjustment, add_null, add_footage, center, set_transform, set_parent, delete, bounds | both |
| property         | get, list, set                                      | kumo |
| keyframe         | add, remove, set_easing (temporal and spatial)      | both |
| expression       | set, clear, check_errors                            | both |
| effect           | apply (name or matchName), list_on_layer, list_available, set_property, set_keyframe, remove, apply_template | llama |
| preset           | apply_ffx, list, search                              | llama |
| marker           | add (comp or layer), add_bulk, list                  | both |
| mask, shape, text | add, set, read (paths, fills, strokes, text document) | kumo |
| audio            | set_levels, info, analyze_waveform and peaks (Node side), peaks_to_markers | llama |
| render           | frame, queue_add, queue_set_output, queue_start, status | kumo |
| font             | list                                                 | kumo |
| command          | find, list, execute (menu commands)                  | kumo |
| batch            | run (many ops, one undo step)                        | kumo |
| eval             | run (arbitrary ExtendScript, off by default)         | both |

**Top-level MCP tools:** `check_setup`, `ae_context`, `ae_project_info`, `ae_comp_info`, `ae_layer_info`, `ae_version_info`, `get_selection`, `find`, `ae_catalog`, `ae_do`, `ae_render_frame`, `ae_save_project`, `job_status`, plus the bulk tools from E9.

Added in v1.1: `project.increment_save` (E13); `thirdparty.apply_preset`, `thirdparty.search`, `ease.preset`, `anchor.move_preserving`, `expression.snippet` and `rig.null_controller` (E14). All operations flagged destructive go through the E13 guard.

## 9. Manual checklist on real AE (tag [HUMAN])

Run the sprint's rows on a real AE with a throwaway project. Record results in `docs/test-runs/<date>.md`.

| Row | Check                                                                                        | From sprint |
| --- | -------------------------------------------------------------------------------------------- | ----------- |
| 1   | Spike questions 1 to 6 answered and ADR 0001 Accepted                                        | S1 |
| 2   | Bridge heartbeat appears within 30 s of AE launch with no panel open                         | S3 |
| 3   | check_setup is all green, then reports the right fix after each: AE closed, loader removed, scripting preference off | S3 |
| 4   | ae_project_info and ae_layer_info match what AE shows                                        | S4 |
| 5   | One Cmd+Z reverts one ae_do call, including a batch.run of 10 ops                            | S5 |
| 6   | One operation per category in section 8 works                                                | S5 |
| 7   | Read-only mode blocks every mutating op; eval.run absent by default                          | S5 |
| 8   | Export JSON, edit, import with clearFirst: structure restored                                | S5 |
| 9   | render_frame returns a visible PNG; a 5 s render via aerender completes and can be cancelled | S5 |
| 10  | Bulk rename of 100 layers: dry run first, apply, undo                                        | S6 |
| 11  | Clean-Mac install from the .dmg in under 5 minutes, ends with a green live test              | S7 |
| 12  | AE modal dialog open: server reports the stall instead of a bare timeout                     | S7 |
| 13  | Install a newer AE version: Fix button re-installs the loader                                | S7 |

## 10. Risks

| Risk                                                            | Mitigation                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Startup polling collides with other scripts (AE runs one script at a time) | Spike decides the transport; serialize jobs; chunk long work; busy lock                 |
| Cold launch of AE is unreliable                                 | Spike measures it; prefer asking the user to open AE; check_setup says so                                     |
| Scripts/Startup needs admin rights                              | One password prompt; manual fallback text                                                                     |
| Prefs file edit is undocumented                                  | Optional step with backup and verification; manual instruction fallback                                       |
| Adobe moves AE to UXP                                           | Transport and bridge sit behind interfaces; UXP is in the icebox                                              |
| LLM invents AE API calls                                        | Rule 5 and the lookup requirement; ES3 lint; fake-bridge contract tests                                        |
| Arbitrary code execution through eval.run                       | Off by default; read-only mode; queue directory permissions                                                   |
| Project data goes to the LLM provider                           | Document it in the user guide; read-only mode for sensitive work                                              |

## 11. Icebox and open questions

**Icebox:** UXP bridge, notarized builds, recipes (lower thirds, kinetic text), Claude Desktop auto-update of the extension, self-hosted Mac runner with AE for nightly smoke tests.

**Open for the owner**

- Which Mister Horse product (free or paid Animation Composer) and which Mt. Mograph extensions (Motion 4, others) do you use? The answer sets the scope of E14.
- Which two or three tasks eat most of your AE time? The answer reorders E9.
