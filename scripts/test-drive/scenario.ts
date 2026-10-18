/**
 * The test-drive scenario: an ordered list of steps that exercises every MCP
 * tool and every `ae_do` operation once against a live After Effects.
 *
 * `scenario.test.ts` (coverage.test.ts) asserts every registered tool and
 * operation appears here, as a step or as an explicit skip with a reason, so a
 * new operation cannot ship without a drive step.
 */

import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type StepKind = 'tool' | 'op' | 'plan';

export interface ToolResult {
  isError: boolean;
  /** First text content block. */
  text: string;
  /** `text` parsed as JSON, or null. */
  json: unknown;
  images: Array<{ data: string; mimeType: string }>;
}

export interface DriveState {
  /** `ae-mcp test drive <timestamp>`; every created item name starts with it. */
  prefix: string;
  folder: string;
  comp: string;
  /** Layers of the scene comp from the last `ae_layer_info` refresh. */
  layers: Array<{ index: number; name: string; type?: string }>;
  /** Files written by `ae_render_frame`. */
  frames: Array<{ time: number; file: string }>;
  importedName: string;
  importedId: number | string;
  snapshot: unknown;
  preset: string;
  planId: string;
  /** Free-form scratch values set by `after` hooks. */
  vars: Record<string, unknown>;
}

export interface Step {
  id: string;
  kind: StepKind;
  /** Tool name, operation name, or (for `plan`) the bulk operation name. */
  name: string;
  /** Report category; defaults to the operation family or `tools`. */
  category?: string;
  args: (state: DriveState) => Record<string, unknown>;
  after?: (result: ToolResult, state: DriveState) => void;
  /** JSX run through DoScriptFile before the step (selecting keys, layers). */
  before?: (state: DriveState) => string;
  /** The step passes only when the call is an error (deliberate failure). */
  expectError?: boolean;
  /** `plan` steps run `ae_apply` after `ae_plan` unless false (dry run only). */
  apply?: boolean;
  /** Static skip: the step is listed, never run. */
  skip?: string;
  /** Dynamic skip, decided from earlier results. */
  skipIf?: (state: DriveState) => string | undefined;
  /** Skip decided from the call's own result (an environment limit, not a product bug). */
  skipOnResult?: (result: ToolResult) => string | undefined;
  /** Repeat the call every `intervalMs` until `until` holds (the step timeout still applies). */
  poll?: { intervalMs: number; until: (result: ToolResult) => boolean };
  /** Step timeout in ms; default 60 s. aerender jobs can take longer on a loaded machine. */
  timeoutMs?: number;
}

export function createState(now: Date = new Date()): DriveState {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const prefix = `ae-mcp test drive ${ts}`;
  return {
    prefix,
    folder: prefix,
    comp: `${prefix} scene`,
    layers: [],
    frames: [],
    importedName: '',
    importedId: '',
    snapshot: null,
    preset: '',
    planId: '',
    vars: {},
  };
}

// ---------------------------------------------------------------- helpers

const POS = 'ADBE Transform Group/ADBE Position';
const OPACITY = 'ADBE Transform Group/ADBE Opacity';
const TEXT_DOCUMENT = 'ADBE Text Properties/ADBE Text Document';
const SCALE = 'ADBE Transform Group/ADBE Scale';
const BLUR = 'ADBE Gaussian Blur 2';
const BLUR_AMOUNT = 'ADBE Gaussian Blur 2-0001';

/** Operation result payload: `ae_do` wraps it as `{result}`. */
function payload(result: ToolResult): Record<string, unknown> {
  const json = result.json as { result?: unknown } | null;
  const inner = json && typeof json === 'object' && 'result' in json ? json.result : json;
  return (inner ?? {}) as Record<string, unknown>;
}

/** 1-based index of the first layer whose name satisfies `match`. */
function layerIndex(state: DriveState, match: string | RegExp): number {
  const found = state.layers.find((layer) =>
    typeof match === 'string' ? layer.name === match : match.test(layer.name),
  );
  if (!found) {
    throw new Error(`no layer matching ${String(match)} in [${state.layers.map((l) => l.name).join(', ')}]`);
  }
  return found.index;
}

function firstString(value: unknown, suffix: string): string | undefined {
  if (typeof value === 'string') {
    return value.endsWith(suffix) ? value : undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const hit = firstString(entry, suffix);
      if (hit) return hit;
    }
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      const hit = firstString(entry, suffix);
      if (hit) return hit;
    }
  }
  return undefined;
}

const op = (
  id: string,
  name: string,
  args: Step['args'],
  extra: Partial<Step> = {},
): Step => ({ id, kind: 'op', name, args, ...extra });

const tool = (
  id: string,
  name: string,
  args: Step['args'],
  extra: Partial<Step> = {},
): Step => ({ id, kind: 'tool', name, category: 'tools', args, ...extra });

const plan = (
  id: string,
  name: string,
  args: Step['args'],
  extra: Partial<Step> = {},
): Step => ({ id, kind: 'plan', name, category: 'bulk', args, ...extra });

const skipOp = (name: string, reason: string): Step => ({
  id: `skip:${name}`,
  kind: 'op',
  name,
  args: () => ({}),
  skip: reason,
});

const skipTool = (name: string, reason: string): Step => ({
  id: `skip:${name}`,
  kind: 'tool',
  name,
  args: () => ({}),
  skip: reason,
});

/** A file in the drive's output folder (`.tmp/test-drive`). */
const outFile = (s: DriveState, name: string): string => join(s.vars.outputDir as string, name);

/** ae_dialogs needs Accessibility to read AE's windows; without it the step is a skip, not a failure. */
const accessibilitySkip = (result: ToolResult): string | undefined =>
  result.isError && result.text.includes('Accessibility') ? 'grant Accessibility to run this' : undefined;

const jobStatusOf = (result: ToolResult): string | undefined =>
  (result.json as { status?: string } | null)?.status;

const refreshLayers = (id: string): Step =>
  tool(id, 'ae_layer_info', (s) => ({ comp: s.comp }), {
    after: (result, state) => {
      const json = result.json as { layers?: Array<{ index: number; name: string; type?: string }> } | null;
      state.layers = json?.layers ?? [];
    },
  });

/** JSX that selects keyframes of one property of one layer. */
function selectKeysJsx(comp: string, layer: number, propertyPath: string, keys: number[]): string {
  return `
var c = null;
for (var i = 1; i <= app.project.numItems; i++) {
  var it = app.project.item(i);
  if (it instanceof CompItem && it.name === ${JSON.stringify(comp)}) { c = it; break; }
}
var l = c.layer(${layer});
var p = l;
var parts = ${JSON.stringify(propertyPath)}.split('/');
for (var k = 0; k < parts.length; k++) { p = p.property(parts[k]); }
for (var n = 1; n <= p.numKeys; n++) { p.setSelectedAtKey(n, false); }
var keys = ${JSON.stringify(keys)};
for (var m = 0; m < keys.length; m++) { p.setSelectedAtKey(keys[m], true); }
'selected';`;
}

/** JSX that selects one layer (for layer.center). */
function selectLayerJsx(comp: string, layer: number): string {
  return `
var c = null;
for (var i = 1; i <= app.project.numItems; i++) {
  var it = app.project.item(i);
  if (it instanceof CompItem && it.name === ${JSON.stringify(comp)}) { c = it; break; }
}
for (var n = 1; n <= c.numLayers; n++) { c.layer(n).selected = false; }
c.layer(${layer}).selected = true;
'selected';`;
}

const SQUARE = [
  [400, 200],
  [1500, 200],
  [1500, 900],
  [400, 900],
];

// ---------------------------------------------------------------- scenario

export const scenario: Step[] = [
  // --- read-only orientation -------------------------------------------------
  tool('check_setup', 'check_setup', () => ({})),
  tool('ae_version_info', 'ae_version_info', () => ({})),
  tool('ae_context', 'ae_context', () => ({})),
  tool('ae_project_info', 'ae_project_info', () => ({})),
  tool('ae_catalog', 'ae_catalog', () => ({})),
  tool('ae_describe', 'ae_describe', () => ({ op: 'project.info' })),
  tool('ae_dialogs.list', 'ae_dialogs', () => ({ action: 'list' }), { skipOnResult: accessibilitySkip }),
  tool('get_selection', 'get_selection', () => ({})),
  op('project.info', 'project.info', () => ({})),
  op('project.report_usage', 'project.report_usage', () => ({})),
  op('project.lint', 'project.lint', () => ({ naming: { pattern: '^[A-Za-z]' } })),

  // --- scratch comp inside a scratch folder ----------------------------------
  op('comp.create', 'comp.create', (s) => ({
    name: s.comp,
    width: 1920,
    height: 1080,
    duration: 6,
    fps: 30,
    pixelAspect: 1,
  })),
  op('bulk.organize_items.folder', 'bulk.organize_items', (s) => ({
    folders: [{ name: s.folder, items: [s.comp] }],
    dryRun: false,
  })),
  op('comp.info', 'comp.info', (s) => ({ comp: s.comp })),
  tool('ae_comp_info', 'ae_comp_info', (s) => ({ comps: [s.comp] })),

  // --- build the scene (each add lands on top of the stack) ------------------
  op('layer.add_solid', 'layer.add_solid', (s) => ({ comp: s.comp, color: [0.05, 0.08, 0.2] })),
  op('shape.add.rect', 'shape.add', (s) => ({
    comp: s.comp,
    type: 'rect',
    layerName: 'Shapes',
    name: 'Card',
    size: [600, 300],
    fillColor: [0.9, 0.3, 0.3],
    fillOpacity: 80,
    strokeColor: [1, 1, 1],
    strokeWidth: 4,
  })),
  op('shape.add.ellipse', 'shape.add', (s) => ({
    comp: s.comp,
    layerIndex: 1,
    type: 'ellipse',
    name: 'Dot',
    size: [160, 160],
    position: [480, 300],
    fillColor: [0.2, 0.8, 0.9],
  })),
  op('shape.add.path', 'shape.add', (s) => ({
    comp: s.comp,
    layerIndex: 1,
    type: 'path',
    name: 'Triangle',
    vertices: [
      [0, -100],
      [100, 80],
      [-100, 80],
    ],
    closed: true,
    fillColor: [0.95, 0.85, 0.2],
    groupOpacity: 90,
  })),
  // Group 3 is the Triangle: group 1 is the Card rect, which has no path.
  op('shape.set', 'shape.set', (s) => ({
    comp: s.comp,
    layerIndex: 1,
    group: 3,
    vertices: [
      [0, -120],
      [120, 90],
      [-120, 90],
    ],
    closed: true,
  })),
  op('shape.read', 'shape.read', (s) => ({ comp: s.comp, layerIndex: 1 })),
  op('text.add', 'text.add', (s) => ({
    comp: s.comp,
    text: 'Hello drive',
    fontSize: 120,
    fillColor: [1, 1, 1],
    justification: 'center',
    tracking: 20,
    leading: 10,
  })),
  op('text.set', 'text.set', (s) => ({ comp: s.comp, layerIndex: 1, text: 'Hello drive!', fontSize: 110 })),
  op('text.read', 'text.read', (s) => ({ comp: s.comp, layerIndex: 1 })),
  op('text.animate', 'text.animate', (s) => ({
    comp: s.comp,
    index: 1,
    preset: 'typewriter',
    duration: 2,
  })),
  op('layer.add_text', 'layer.add_text', (s) => ({ comp: s.comp, text: 'Text' })),
  op('layer.add_null', 'layer.add_null', (s) => ({ comp: s.comp })),
  op('layer.add_adjustment', 'layer.add_adjustment', (s) => ({ comp: s.comp })),
  op('layer.add_shape', 'layer.add_shape', (s) => ({ comp: s.comp })),
  op('layer.add_camera', 'layer.add_camera', (s) => ({ comp: s.comp, name: 'Drive Camera' })),
  op('layer.add_light', 'layer.add_light', (s) => ({
    comp: s.comp,
    name: 'Drive Light',
    lightType: 'point',
  })),
  refreshLayers('ae_layer_info.before-rig'),
  op('rig.null_controller', 'rig.null_controller', (s) => ({
    comp: s.comp,
    name: 'Drive Controller',
    sliders: ['Speed', 'Amount'],
    layers: [layerIndex(s, 'Null')],
  })),
  op('template.lower_third', 'template.lower_third', (s) => ({
    comp: s.comp,
    title: 'Test Drive',
    subtitle: 'every tool, once',
    duration: 4,
  })),
  refreshLayers('ae_layer_info.after-build'),
  op('template.title_card', 'template.title_card', (s) => ({
    comp: s.comp,
    title: 'Title Card',
    subtitle: 'test drive',
    duration: 4,
  })),
  refreshLayers('ae_layer_info.after-title-card'),
  op('template.transition', 'template.transition', (s) => ({
    comp: s.comp,
    from: layerIndex(s, 'Shapes'),
    to: layerIndex(s, 'Solid'),
    style: 'push',
    duration: 0.5,
  })),
  op('template.logo_reveal', 'template.logo_reveal', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Text'),
    style: 'fade_scale',
  })),
  op('look.apply', 'look.apply', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Solid'),
    look: 'glow',
  })),
  op('look.apply.vhs', 'look.apply', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Solid'),
    look: 'vhs',
  })),
  op('template.lower_third.news', 'template.lower_third', (s) => ({
    comp: s.comp,
    title: 'News Style',
    style: 'news',
    duration: 4,
  })),
  op('template.title_card.cinematic', 'template.title_card', (s) => ({
    comp: s.comp,
    title: 'Cinematic',
    style: 'cinematic',
    duration: 4,
  })),
  op('template.transition.wipe', 'template.transition', (s) => ({
    comp: s.comp,
    from: layerIndex(s, 'Shapes'),
    to: layerIndex(s, 'Solid'),
    style: 'wipe',
    duration: 0.5,
  })),
  refreshLayers('ae_layer_info.before-glitch'),
  op('template.logo_reveal.glitch', 'template.logo_reveal', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Text'),
    style: 'glitch',
  })),
  // #239: one version comp per row, named with the drive prefix so the cleanup removes it.
  plan('versions.generate', 'versions.generate', (s) => ({
    comp: s.comp,
    versions: [{ name: `${s.comp} version A`, texts: { Text: 'Version A' } }],
  })),
  tool('versions_generate', 'versions_generate', (s) => ({
    comp: s.comp,
    rows: [{ name: 'row', title: 'Row' }],
    mapping: [{ layer: 'Text', text: 'title' }],
    nameColumn: 'name',
  })),
  op('text.animate.blur_in', 'text.animate', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Text'),
    preset: 'blur_in',
    duration: 1,
  })),
  op('expression.snippet.bounce_soft', 'expression.snippet', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Null'),
    property: POS,
    snippet: 'bounce_soft',
  })),
  refreshLayers('ae_layer_info.after-templates'),
  op('layer.set_3d.shape', 'layer.set_3d', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    enabled: true,
  })),
  op('layer.set_3d.solid', 'layer.set_3d', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Solid'),
    enabled: true,
  })),

  // --- transforms, parenting, properties ------------------------------------
  op('layer.set_transform', 'layer.set_transform', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    position: [960, 540, 0],
    scale: [100, 100, 100],
    opacity: 100,
  })),
  op('layer.set_parent', 'layer.set_parent', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Text'),
    parent: layerIndex(s, 'Null'),
  })),
  // E16-5: move Text to the top of the stack, then refresh the layer list the later steps read.
  op('layer.move', 'layer.move', (s) => ({ comp: s.comp, index: layerIndex(s, 'Text'), to: 'top' })),
  refreshLayers('layers.after_move'),
  op('layer.bounds', 'layer.bounds', (s) => ({ comp: s.comp, index: layerIndex(s, 'Shapes'), time: 1 })),
  op('anchor.move_preserving', 'anchor.move_preserving', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    anchor: 'top-left',
  })),
  op('property.get', 'property.get', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    name: POS,
  })),
  op('property.set', 'property.set', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    name: SCALE,
    value: [100, 100, 100],
  })),
  op('property.list', 'property.list', (s) => ({ comp: s.comp })),
  // --- verify: snapshot, change, diff, then sample a keyed property -----------
  op('comp.snapshot', 'comp.snapshot', (s) => ({ comp: s.comp }), {
    after: (result, state) => {
      state.vars.compSnapshot = payload(result);
    },
  }),
  op('property.set.opacity_for_diff', 'property.set', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    name: OPACITY,
    value: 60,
  })),
  op('comp.diff', 'comp.diff', (s) => ({ comp: s.comp, snapshot: s.vars.compSnapshot })),
  op('comp.layer_clip_frames', 'comp.layer_clip_frames', (s) => ({
    comp: s.comp,
    from: 0,
    to: 180,
    layers: [layerIndex(s, 'Null')],
  })),

  // --- keyframes -------------------------------------------------------------
  op('keyframe.add.pos0', 'keyframe.add', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    property: POS,
    time: 0,
    value: [400, 540, 0],
  })),
  op('keyframe.add.pos1', 'keyframe.add', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    property: POS,
    time: 1.5,
    value: [960, 300, 0],
  })),
  op('keyframe.add.pos2', 'keyframe.add', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    property: POS,
    time: 3,
    value: [1500, 540, 0],
  })),
  op('keyframe.add.pos3', 'keyframe.add', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    property: POS,
    time: 4,
    value: [1500, 700, 0],
  })),
  op('keyframe.add.opacity0', 'keyframe.add', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    property: OPACITY,
    time: 0,
    value: 0,
  })),
  op('keyframe.add.opacity1', 'keyframe.add', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    property: OPACITY,
    time: 1,
    value: 100,
  })),
  op('keyframe.set_easing', 'keyframe.set_easing', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    property: POS,
    time: 1.5,
    easing: 'easeIn',
  })),
  op(
    'keyframe.ease_preset',
    'keyframe.ease_preset',
    (s) => ({
      comp: s.comp,
      index: layerIndex(s, 'Shapes'),
      property: OPACITY,
      preset: 'ease_out',
    }),
    { before: (s) => selectKeysJsx(s.comp, layerIndex(s, 'Shapes'), OPACITY, [1, 2]) },
  ),
  op('keyframe.copy', 'keyframe.copy', (s) => ({
    comp: s.comp,
    from: { index: layerIndex(s, 'Shapes'), property: POS },
    to: { index: layerIndex(s, 'Drive Light'), property: POS },
    offset: 0.5,
  })),
  op('keyframe.offset', 'keyframe.offset', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Drive Light'),
    property: POS,
    seconds: 0.25,
  })),
  op('keyframe.reverse', 'keyframe.reverse', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Drive Light'),
    property: POS,
  })),
  op('keyframe.scale_time', 'keyframe.scale_time', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Drive Light'),
    property: POS,
    factor: 0.5,
  })),
  op('keyframe.remove', 'keyframe.remove', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    property: POS,
    time: 4,
  })),

  op('property.sample', 'property.sample', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Shapes'),
    property: OPACITY,
    times: [0, 1.5],
  })),
  op('keyframe.times', 'keyframe.times', (s) => ({ comp: s.comp, index: layerIndex(s, 'Shapes') })),

  // --- expressions -----------------------------------------------------------
  op('expression.set', 'expression.set', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Text'),
    property: OPACITY,
    value: 'wiggle(2, 10) + 80',
  })),
  op('expression.check_errors', 'expression.check_errors', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Text'),
    property: OPACITY,
  })),
  op('expression.snippet', 'expression.snippet', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Null'),
    property: POS,
    snippet: 'wiggle',
    amplitude: 20,
    frequency: 1,
  })),
  op('expression.snippet.wiggle_smooth', 'expression.snippet', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Null'),
    property: POS,
    snippet: 'wiggle_smooth',
    frequency: 1,
    amplitude: 15,
    octaves: 2,
  })),
  // loopOut needs keyframes: AE reports "this property has no keyframes" otherwise (E15-3).
  op('keyframe.add.null0', 'keyframe.add', (s) => ({ comp: s.comp, index: layerIndex(s, 'Null'), property: POS, time: 0, value: [960, 540, 0] })),
  op('keyframe.add.null1', 'keyframe.add', (s) => ({ comp: s.comp, index: layerIndex(s, 'Null'), property: POS, time: 1, value: [1100, 540, 0] })),
  op('expression.snippet.loop_cycle', 'expression.snippet', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Null'),
    property: POS,
    snippet: 'loop_cycle',
  })),
  op('expression.snippet.loop_offset', 'expression.snippet', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Null'),
    property: POS,
    snippet: 'loop_offset',
  })),
  op('expression.snippet.spring', 'expression.snippet', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Null'),
    property: POS,
    snippet: 'spring',
    frequency: 2,
    decay: 4,
  })),
  op('expression.clear.snippets', 'expression.clear', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Null'),
    property: POS,
  })),
  op('expression.snippet.clock', 'expression.snippet', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Text'),
    property: TEXT_DOCUMENT,
    snippet: 'clock',
  })),
  op('expression.clear.clock', 'expression.clear', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Text'),
    property: TEXT_DOCUMENT,
  })),
  tool('ae_expression_report', 'ae_expression_report', (s) => ({ comps: [s.comp] })),
  op('expression.clear', 'expression.clear', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Text'),
    property: OPACITY,
  })),

  // --- masks -----------------------------------------------------------------
  op('mask.add', 'mask.add', (s) => ({
    comp: s.comp,
    layerIndex: layerIndex(s, 'Solid'),
    vertices: SQUARE,
    closed: true,
  })),
  op('mask.set', 'mask.set', (s) => ({
    comp: s.comp,
    layerIndex: layerIndex(s, 'Solid'),
    maskIndex: 1,
    vertices: [
      [300, 150],
      [1600, 150],
      [1600, 950],
      [300, 950],
    ],
    closed: true,
  })),
  op('mask.read', 'mask.read', (s) => ({ comp: s.comp, layerIndex: layerIndex(s, 'Solid'), maskIndex: 1 })),

  // --- effects ---------------------------------------------------------------
  op('effect.list_available', 'effect.list_available', () => ({})),
  op('effect.apply', 'effect.apply', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Solid'),
    effect: BLUR,
  })),
  op('effect.list_on_layer', 'effect.list_on_layer', (s) => ({ comp: s.comp, index: layerIndex(s, 'Solid') })),
  op('effect.set_property', 'effect.set_property', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Solid'),
    effect: BLUR,
    property: BLUR_AMOUNT,
    value: 5,
  })),
  op('effect.set_keyframe', 'effect.set_keyframe', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Solid'),
    effect: BLUR,
    property: BLUR_AMOUNT,
    time: 2,
    value: 25,
  })),
  op('effect.remove', 'effect.remove', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Solid'),
    effect: BLUR,
  })),

  // --- presets ---------------------------------------------------------------
  op('preset.list', 'preset.list', () => ({}), {
    // run.ts sets state.preset from the Presets folder; keep it when already set.
    after: (result, state) => {
      state.preset = state.preset || (firstString(payload(result), '.ffx') ?? '');
    },
  }),
  op('preset.search', 'preset.search', () => ({ query: 'blur' })),
  op(
    'preset.apply_ffx',
    'preset.apply_ffx',
    (s) => ({ comp: s.comp, index: layerIndex(s, 'Null'), path: s.preset }),
    { skipIf: (s) => (s.preset === '' ? 'no .ffx preset found under the AE Presets folder' : undefined) },
  ),

  // --- markers ---------------------------------------------------------------
  op('marker.add', 'marker.add', (s) => ({ comp: s.comp, time: 1, comment: 'comp marker', duration: 0.5 })),
  op('marker.add_bulk', 'marker.add_bulk', (s) => ({
    comp: s.comp,
    layerIndex: layerIndex(s, 'Shapes'),
    markers: [
      { time: 0.5, comment: 'a' },
      { time: 2, comment: 'b', duration: 1 },
    ],
  })),
  op('marker.list', 'marker.list', (s) => ({ comp: s.comp })),

  // --- discovery -------------------------------------------------------------
  op('font.list', 'font.list', () => ({})),
  op('command.find', 'command.find', () => ({ name: 'Save' })),
  op('command.list', 'command.list', () => ({})),
  tool('find', 'find', () => ({ query: 'Shapes', kinds: ['layer'] })),

  // --- render ----------------------------------------------------------------
  ...[0, 3, 5.9].map((time, i) =>
    tool(`ae_render_frame.${i + 1}`, 'ae_render_frame', (s) => ({ comp: s.comp, time }), {
      after: (result, state) => {
        const meta = result.json as { file?: string } | null;
        if (typeof meta?.file === 'string') {
          state.frames.push({ time, file: meta.file });
        }
      },
    }),
  ),
  tool('ae_render_frame.compare', 'ae_render_frame', (s) => ({ comp: s.comp, time: 3, compareWith: s.frames[0]?.file }), {
    skipIf: (s) => (s.frames.length === 0 ? 'no earlier frame to compare with' : undefined),
    after: (result) => {
      const meta = result.json as { compare?: unknown } | null;
      if (!meta?.compare) {
        throw new Error('ae_render_frame compareWith returned no compare block');
      }
    },
  }),
  tool('ae_render_frame.at_keys', 'ae_render_frame', (s) => ({ comp: s.comp, atKeys: true, index: layerIndex(s, 'Shapes') }), {
    after: (result) => {
      if (result.isError) {
        throw new Error('ae_render_frame atKeys failed: ' + result.text);
      }
    },
  }),
  op('render.frame', 'render.frame', (s) => ({ comp: s.comp, time: 4 })),
  op('render.queue_add', 'render.queue_add', (s) => ({
    comp: s.comp,
    timeSpanStart: 0,
    timeSpanDuration: 1,
  })),
  // E16-6: a spare item added and removed again, so item 1 stays for the steps below.
  op('render.queue_add.spare', 'render.queue_add', (s) => ({ comp: s.comp, timeSpanStart: 0, timeSpanDuration: 1 })),
  op('render.queue_remove', 'render.queue_remove', () => ({ index: 2 })),
  op('render.queue_set_output', 'render.queue_set_output', (s) => ({
    item: 1,
    file: `${s.vars.outputDir as string}/${s.prefix} queue.mov`,
  })),
  op('render.status', 'render.status', () => ({})),
  op('render.templates', 'render.templates', (s) => ({ comp: s.comp })),
  // E16-6: dry run only; lists what is under <root>/render without deleting anything.
  tool('render_clean.dry', 'render_clean', () => ({ dryRun: true })),

  // --- aerender: it reads the saved project file, so save the scratch project first
  op('project.save.copy', 'project.save', (s) => ({ path: outFile(s, 'drive-copy.aep'), overwrite: true })),
  op('project.save.scratch', 'project.save', (s) => ({ path: outFile(s, 'drive.aep'), overwrite: true })),
  // #241: AE exports only a saved project with at least one control, else it shows a
  // modal. The first call adds the control and stops (exported: false), then save, export.
  op('mogrt.export.controls', 'mogrt.export', (s) => ({
    comp: s.comp,
    path: outFile(s, 'drive.mogrt'),
    overwrite: true,
    controls: [{ layer: layerIndex(s, 'Text'), property: 'Opacity', name: 'Drive Fade' }],
  }), {
    after: (result) => {
      if (payload(result).exported !== false) throw new Error(`expected exported: false, got ${result.text.slice(0, 300)}`);
    },
  }),
  op('project.save.mogrt', 'project.save', (s) => ({ path: outFile(s, 'drive.aep'), overwrite: true })),
  op('mogrt.export', 'mogrt.export', (s) => ({ comp: s.comp, path: outFile(s, 'drive.mogrt'), overwrite: true }), {
    after: (result, state) => {
      if (payload(result).exported !== true) throw new Error(`mogrt.export did not export: ${result.text.slice(0, 300)}`);
      if (!existsSync(outFile(state, 'drive.mogrt'))) throw new Error('mogrt.export wrote no drive.mogrt');
    },
  }),
  op('mogrt.export.exists', 'mogrt.export', (s) => ({ comp: s.comp, path: outFile(s, 'drive.mogrt') }), {
    expectError: true,
  }),
  // #240: one 1:1 copy (named after the drive comp, so the cleanup removes it) and one aerender job.
  tool('export_preset', 'export_preset', (s) => ({ comp: s.comp, formats: ['1:1'], outputDir: s.vars.outputDir }), {
    after: (result, state) => {
      const jobs = (result.json as { jobs?: Array<{ jobId?: string; output?: string; error?: string }> } | null)?.jobs ?? [];
      if (jobs.length !== 1 || typeof jobs[0]!.jobId !== 'string') throw new Error(`export_preset returned ${result.text.slice(0, 300)}`);
      state.vars.presetJobId = jobs[0]!.jobId;
      state.vars.presetOutput = jobs[0]!.output;
    },
  }),
  // Wait for it before the next render: two aerender runs of one project at once
  // exited 0 without writing the preset file.
  tool('job_status.export_preset', 'job_status', (s) => ({ jobId: s.vars.presetJobId }), {
    timeoutMs: 180_000,
    poll: { intervalMs: 500, until: (result) => jobStatusOf(result) !== 'running' },
    after: (result, state) => {
      if (jobStatusOf(result) !== 'succeeded') throw new Error(`preset render ended as ${result.text.slice(0, 300)}`);
      const file = state.vars.presetOutput as string;
      if (statSync(file).size === 0) throw new Error(`preset render produced an empty file: ${file}`);
    },
  }),
  // #239 with render: one copy named with the drive prefix (removed by the cleanup), one aerender job.
  tool('versions_generate.render', 'versions_generate', (s) => ({
    comp: s.comp,
    rows: [{ name: `${s.prefix} render row`, title: 'Rendered row' }],
    mapping: [{ layer: 'Text', text: 'title' }],
    nameColumn: 'name',
    dryRun: false,
    render: true,
    renderDir: s.vars.outputDir,
  }), {
    after: (result, state) => {
      const jobs = (result.json as { jobs?: Array<{ jobId?: string }> } | null)?.jobs ?? [];
      if (jobs.length !== 1 || typeof jobs[0]!.jobId !== 'string') throw new Error(`versions_generate returned ${result.text.slice(0, 300)}`);
      state.vars.versionJobId = jobs[0]!.jobId;
    },
  }),
  tool('job_status.versions_generate', 'job_status', (s) => ({ jobId: s.vars.versionJobId }), {
    timeoutMs: 180_000,
    poll: { intervalMs: 500, until: (result) => jobStatusOf(result) !== 'running' },
    after: (result) => {
      if (jobStatusOf(result) !== 'succeeded') throw new Error(`version render ended as ${result.text.slice(0, 300)}`);
    },
  }),
  tool('ae_render', 'ae_render', (s) => ({ comp: s.comp, output: outFile(s, 'render.mov'), startFrame: 0, endFrame: 29 }), {
    after: (result, state) => {
      const jobId = (result.json as { jobId?: string } | null)?.jobId;
      if (typeof jobId !== 'string') throw new Error('ae_render returned no jobId');
      state.vars.renderJobId = jobId;
    },
  }),
  tool('job_status', 'job_status', (s) => ({ jobId: s.vars.renderJobId }), {
    poll: { intervalMs: 500, until: (result) => jobStatusOf(result) !== 'running' },
    after: (result, state) => {
      const status = jobStatusOf(result);
      if (status !== 'succeeded') throw new Error(`render job ended as ${String(status)}: ${result.text.slice(0, 300)}`);
      const file = outFile(state, 'render.mov');
      if (statSync(file).size === 0) throw new Error(`render produced an empty file: ${file}`);
    },
  }),
  tool('ae_render.cancel', 'ae_render', (s) => ({ comp: s.comp, output: outFile(s, 'render-cancel.mov'), startFrame: 0, endFrame: 29 }), {
    after: (result, state) => {
      const jobId = (result.json as { jobId?: string } | null)?.jobId;
      if (typeof jobId !== 'string') throw new Error('ae_render returned no jobId');
      state.vars.cancelJobId = jobId;
    },
  }),
  // A render that already finished reports `succeeded`: cancel is then a no-op, which is fine.
  tool('job_cancel', 'job_cancel', (s) => ({ jobId: s.vars.cancelJobId }), {
    after: (result) => {
      if (jobStatusOf(result) === 'failed') throw new Error(`cancelled render job failed: ${result.text.slice(0, 300)}`);
    },
  }),

  // --- footage ---------------------------------------------------------------
  op(
    'project.import_file',
    'project.import_file',
    (s) => ({ path: s.frames[0]!.file, folder: s.folder }),
    {
      after: (result, state) => {
        const items = payload(result).items as Array<{ id: number; name: string }> | undefined;
        state.importedName = items?.[0]?.name ?? '';
        state.importedId = items?.[0]?.id ?? '';
      },
      skipIf: (s) => (s.frames.length === 0 ? 'no rendered frame to import' : undefined),
    },
  ),
  op('layer.add_footage', 'layer.add_footage', (s) => ({ comp: s.comp, name: s.importedName })),
  op('footage.replace', 'footage.replace', (s) => ({ item: s.importedName, path: s.frames[1]!.file }), {
    skipIf: (s) => (s.frames.length < 2 ? 'no second rendered frame' : undefined),
  }),
  // Dry run only: nothing in the project is missing, so nothing is relinked.
  op('footage.relink', 'footage.relink', (s) => ({ folder: dirname(s.frames[0]!.file), recursive: false }), {
    skipIf: (s) => (s.frames.length === 0 ? 'no rendered frame to search' : undefined),
  }),
  // The render folder (~/.ae-mcp/render) holds the frames written above.
  op(
    'project.import_folder',
    'project.import_folder',
    (s) => ({ path: dirname(s.frames[0]!.file), recursive: false, folder: s.folder }),
    {
      skipIf: (s) => (s.frames.length === 0 ? 'no rendered frame to import' : undefined),
    },
  ),
  skipOp('eval.run', 'off by default; runs arbitrary code'),

  // --- project snapshot round trip -------------------------------------------
  op('project.export_json', 'project.export_json', () => ({}), {
    after: (result, state) => {
      const snapshot = payload(result) as { items?: Array<{ name: string; type: string }> };
      const items = (snapshot.items ?? [])
        .filter((item) => item.type === 'Composition' && item.name === state.comp)
        .map((item) => ({ ...item, name: `${state.prefix} imported` }));
      state.snapshot = { ...snapshot, items };
    },
  }),
  op('project.import_json', 'project.import_json', (s) => ({ snapshot: s.snapshot })),

  // --- comp operations -------------------------------------------------------
  op('comp.duplicate', 'comp.duplicate', (s) => ({ comp: s.comp, newName: `${s.prefix} copy` })),
  op('comp.set_settings', 'comp.set_settings', (s) => ({
    comp: `${s.prefix} copy`,
    width: 1280,
    height: 720,
    duration: 5,
    frameRate: 24,
    bgColor: [0.1, 0.1, 0.1],
  })),
  op('comp.precompose', 'comp.precompose', (s) => ({
    comp: `${s.prefix} copy`,
    newName: `${s.prefix} precomp`,
    layers: [1, 2],
    moveAllAttributes: true,
  })),

  // --- layer housekeeping ----------------------------------------------------
  refreshLayers('ae_layer_info.after-edits'),
  tool('get_selection.after-edits', 'get_selection', () => ({})),
  op(
    'layer.center',
    'layer.center',
    (s) => ({ comp: s.comp }),
    { before: (s) => selectLayerJsx(s.comp, layerIndex(s, 'Null')) },
  ),
  op('layer.rename', 'layer.rename', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Adjustment'),
    name: 'Adjustment Scratch',
  })),
  refreshLayers('ae_layer_info.after-layer-rename'),
  op('layer.delete', 'layer.delete', (s) => ({ comp: s.comp, index: layerIndex(s, /^Adjustment/) })),
  refreshLayers('ae_layer_info.after-delete'),

  // --- bulk operations: ae_plan then ae_apply on scratch layers only ---------
  plan('bulk.rename', 'bulk.rename', (s) => ({
    comp: s.comp,
    layers: [layerIndex(s, 'Null')],
    prefix: 'TD ',
  })),
  refreshLayers('ae_layer_info.after-rename'),
  plan('bulk.set_property', 'bulk.set_property', (s) => ({
    comp: s.comp,
    layers: [layerIndex(s, /Null$/)],
    property: OPACITY,
    value: 90,
  })),
  plan('bulk.apply_effect', 'bulk.apply_effect', (s) => ({
    comp: s.comp,
    layers: [layerIndex(s, 'Solid')],
    effect: BLUR,
  })),
  plan('bulk.set_expression', 'bulk.set_expression', (s) => ({
    comp: s.comp,
    layers: [layerIndex(s, 'Text')],
    property: OPACITY,
    expression: 'value',
  })),
  plan(
    'bulk.apply_preset',
    'bulk.apply_preset',
    (s) => ({ comp: s.comp, layers: [layerIndex(s, 'Solid')], preset: s.preset }),
    { skipIf: (s) => (s.preset === '' ? 'no .ffx preset found under the AE Presets folder' : undefined) },
  ),
  plan('bulk.replace_text', 'bulk.replace_text', (s) => ({
    comp: s.comp,
    find: 'Text',
    replace: 'Caption v2',
  })),
  plan('bulk.stagger', 'bulk.stagger', (s) => ({
    comp: s.comp,
    layers: [layerIndex(s, 'Solid'), layerIndex(s, 'Text')],
    target: 'layers',
    mode: 'fixed',
    offset: 0.1,
  })),
  plan('bulk.set_label', 'bulk.set_label', (s) => ({
    comp: s.comp,
    layers: [layerIndex(s, 'Solid')],
    label: 5,
  })),
  plan('bulk.duplicate_comp', 'bulk.duplicate_comp', (s) => ({
    comp: s.comp,
    name: `${s.prefix} dup`,
    width: 960,
    height: 540,
  })),
  plan('bulk.resize_comp', 'bulk.resize_comp', (s) => ({
    comp: s.comp,
    formats: [{ name: `${s.prefix} square`, width: 1080, height: 1080 }],
  })),
  plan('bulk.organize_items', 'bulk.organize_items', (s) => ({
    folders: [{ name: `${s.prefix} misc`, items: [`${s.prefix} dup`] }],
  })),
  plan('bulk.remove_unused', 'bulk.remove_unused', () => ({}), { apply: false }),

  // --- batch.run: one good batch, one that fails and must roll back ----------
  op('batch.run', 'batch.run', (s) => ({
    ops: [
      { op: 'marker.add', args: { comp: s.comp, time: 2.5, comment: 'batch ok' } },
      { op: 'property.get', args: { comp: s.comp, index: 1, name: OPACITY } },
    ],
  })),
  op(
    'batch.run.rollback',
    'batch.run',
    (s) => ({
      ops: [
        { op: 'marker.add', args: { comp: s.comp, time: 3.5, comment: 'batch rolled back' } },
        { op: 'layer.set_transform', args: { comp: s.comp, index: 9999, position: [0, 0] } },
      ],
    }),
    { expectError: true },
  ),
  op('marker.list.after-rollback', 'marker.list', (s) => ({ comp: s.comp }), {
    after: (result) => {
      // No scripted undo (ADR-0009): the failed batch's first step stays applied.
      if (!result.text.includes('batch rolled back')) {
        throw new Error('failed batch removed its marker; batch.run must not undo by script');
      }
    },
  }),

  // --- audio: a generated 1-second tone on the scene comp (last, so earlier layer indices hold)
  op('project.import_file.tone', 'project.import_file', (s) => ({ path: s.vars.toneFile as string, folder: s.folder }), {
    after: (result, state) => {
      const items = payload(result).items as Array<{ name: string }> | undefined;
      state.vars.toneName = items?.[0]?.name ?? '';
    },
  }),
  op('layer.add_footage.tone', 'layer.add_footage', (s) => ({ comp: s.comp, name: s.vars.toneName })),
  refreshLayers('ae_layer_info.audio'),
  op('audio.info', 'audio.info', (s) => ({ comp: s.comp, layerIndex: layerIndex(s, s.vars.toneName as string) })),
  op('audio.set_levels', 'audio.set_levels', (s) => ({
    comp: s.comp,
    layerIndex: layerIndex(s, s.vars.toneName as string),
    levels: [-6, -6],
  })),
  op('audio.peaks_to_markers', 'audio.peaks_to_markers', (s) => ({
    comp: s.comp,
    layerIndex: layerIndex(s, s.vars.toneName as string),
    peaks: [
      { time: 0.25, comment: 'peak' },
      { time: 0.5, comment: 'peak' },
    ],
  })),
  // #242: a fresh null, so the target property has no keyframes yet.
  op('layer.add_null.audio', 'layer.add_null', (s) => ({ comp: s.comp, name: 'Drive Audio Null' })),
  refreshLayers('ae_layer_info.audio-null'),
  op('audio.to_keyframes', 'audio.to_keyframes', (s) => ({
    comp: s.comp,
    audioLayer: layerIndex(s, s.vars.toneName as string),
    targetLayer: layerIndex(s, 'Drive Audio Null'),
    property: 'Opacity',
  })),
  // #260: a fresh null, one animate call for a position track eased with expo_out, then a sample.
  // expo_out is an ease-out: by the midpoint the layer has covered well over half the distance.
  op('layer.add_null.animate', 'layer.add_null', (s) => ({ comp: s.comp, name: 'Drive Animate Null' })),
  refreshLayers('ae_layer_info.animate-null'),
  op('animate', 'animate', (s) => ({
    comp: s.comp,
    layer: layerIndex(s, 'Drive Animate Null'),
    tracks: { [POS]: [[0, [100, 300]], [1, [500, 300]]] },
    curve: 'expo_out',
  }), {
    after: (result) => {
      if (payload(result).keyframes !== 2) throw new Error(`animate set no keys: ${result.text.slice(0, 300)}`);
    },
  }),
  op('property.sample.animate', 'property.sample', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Drive Animate Null'),
    property: POS,
    times: [0, 0.5, 1],
  }), {
    after: (result) => {
      const samples = (payload(result).samples as Array<{ time: number; value: number[] }> | undefined) ?? [];
      const mid = samples[1]?.value?.[0] ?? NaN;
      if (!(mid > 300)) throw new Error(`expo_out ease-out should pass half the distance by 0.5 s, x was ${mid}`);
    },
  }),
  // #266: a named move end to end. slide_in from the left starts 200 px left of the null's
  // position and ends on it at 0.5 s, so the first sample is 200 px left of the last.
  op('layer.add_null.slide', 'layer.add_null', (s) => ({ comp: s.comp, name: 'Drive Slide Null' })),
  refreshLayers('ae_layer_info.slide-null'),
  op('animate.slide_in', 'animate', (s) => ({
    comp: s.comp,
    layer: layerIndex(s, 'Drive Slide Null'),
    preset: 'slide_in',
    direction: 'left',
    distance: 200,
  })),
  op('property.sample.slide', 'property.sample', (s) => ({
    comp: s.comp,
    index: layerIndex(s, 'Drive Slide Null'),
    property: POS,
    times: [0, 0.25, 0.5],
  }), {
    after: (result) => {
      const samples = (payload(result).samples as Array<{ time: number; value: number[] }> | undefined) ?? [];
      const first = samples[0]?.value?.[0] ?? NaN;
      const last = samples[samples.length - 1]?.value?.[0] ?? NaN;
      if (!(Math.abs(last - first - 200) < 1)) throw new Error(`slide_in should move x by 200 px, moved ${last - first}`);
    },
  }),
  // #245 with apply: import a uniquely named copy of the tone and delete it on disk; the
  // relink runs after project.open, since AE only marks footage missing when the project loads.
  op('project.import_file.missing', 'project.import_file', (s) => {
    const dir = outFile(s, 'missing');
    rmSync(outFile(s, 'relink-source'), { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    copyFileSync(s.vars.toneFile as string, join(dir, 'tone-missing.wav'));
    return { path: join(dir, 'tone-missing.wav'), folder: s.folder };
  }, {
    after: (_result, state) => rmSync(outFile(state, 'missing'), { recursive: true, force: true }),
  }),

  // #243 on its own comp, so no later step reads the rewritten text.
  op('comp.create.localize', 'comp.create', (s) => ({ name: `${s.prefix} localize`, width: 640, height: 360, duration: 1 })),
  op('text.add.localize', 'text.add', (s) => ({ comp: `${s.prefix} localize`, text: 'Hello', fontSize: 100 })),
  op('localize.apply', 'localize.apply', (s) => ({
    comp: `${s.prefix} localize`,
    table: { Hello: 'Bonjour tout le monde, ceci est bien plus long' },
  }), {
    after: (result) => {
      const changes = (payload(result).changes as unknown[] | undefined) ?? [];
      if (changes.length < 1) throw new Error(`localize.apply changed nothing: ${result.text.slice(0, 300)}`);
    },
  }),

  // --- saved-project ops, then the reduce on a scratch comp (these reshape the project)
  op('project.consolidate_footage', 'project.consolidate_footage', () => ({})),
  op('project.increment_save', 'project.increment_save', () => ({})),
  op('project.save.final', 'project.save', (s) => ({ path: outFile(s, 'drive.aep'), overwrite: true })),
  op('project.open', 'project.open', (s) => ({ path: outFile(s, 'drive.aep'), force: true })),
  // The source folder appears only now, after the reload, so AE cannot re-resolve the file itself.
  op('footage.relink.apply', 'footage.relink', (s) => {
    const dir = outFile(s, 'relink-source');
    mkdirSync(dir, { recursive: true });
    copyFileSync(s.vars.toneFile as string, join(dir, 'tone-missing.wav'));
    return { folder: dir, apply: true };
  }, {
    after: (result) => {
      const relinked = (payload(result).relinked as unknown[] | undefined) ?? [];
      if (relinked.length < 1) throw new Error(`footage.relink relinked nothing: ${result.text.slice(0, 300)}`);
    },
  }),
  op('comp.create.reduce', 'comp.create', (s) => ({
    name: `${s.prefix} reduce`,
    width: 320,
    height: 180,
    duration: 1,
    fps: 30,
  })),
  op('project.reduce', 'project.reduce', (s) => ({ items: [`${s.prefix} reduce`] })),

  // --- final look ------------------------------------------------------------
  tool('ae_project_info.final', 'ae_project_info', () => ({})),

  // --- checkpoints -----------------------------------------------------------
  // The drive runs in its own saved scratch project (#224), so a checkpoint only
  // increments that scratch file.
  tool('checkpoint_create', 'checkpoint_create', () => ({ name: 'drive-a' })),
  tool('checkpoint_list', 'checkpoint_list', () => ({})),
  skipTool('checkpoint_revert', 'reopens the project; covered by unit tests'),

  // --- history of Claude's steps (#236) --------------------------------------
  tool('history_list', 'history_list', () => ({ n: 5 })),
  tool('history_export', 'history_export', (s) => ({ format: 'batch', n: 5, path: outFile(s, 'replay.json') })),
  skipTool('script_save', 'writes into the installed After Effects Scripts folder (may need admin rights); unit tests cover it with a temp folder'),
  skipTool('history_undo','never undoes by script (ADR-0009); its answer is covered by unit tests'),

  // --- explicit skips --------------------------------------------------------
  skipOp('project.new', 'run.ts starts the drive with it (fresh scratch project); a mid-drive call would wipe the scratch comp'),
  skipOp('command.execute', 'runs arbitrary menu commands; unsafe in an unattended drive'),
];

/** Names this scenario covers: steps (run or skipped) plus the tools they imply. */
export function coveredNames(steps: Step[] = scenario): Set<string> {
  const names = new Set<string>();
  for (const step of steps) {
    names.add(step.name);
    if (step.kind === 'op') {
      names.add('ae_do');
    } else if (step.kind === 'plan') {
      names.add('ae_plan');
      if (step.apply !== false) {
        names.add('ae_apply');
      }
    }
  }
  return names;
}
