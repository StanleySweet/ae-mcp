import { HandlerError, type HandlerMap } from './consumer.js';
import { compInfo, findComp } from './handlers.js';
import type { Comp, FakeProject } from './project.js';

// Fake counterparts of the bridge's comp.* handlers. Same arguments, same results and the
// same INVALID_ARGS failures, backed by the in-memory FakeProject.

function invalid(message: string): never {
  throw new HandlerError('INVALID_ARGS', message);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

type Args = Record<string, unknown>;

function asArgs(args: unknown): Args {
  return typeof args === 'object' && args !== null ? (args as Args) : {};
}

function requireComp(project: FakeProject, key: unknown): Comp {
  const comp = findComp(project, key);
  if (comp) {
    return comp;
  }
  if (key === undefined || key === null || key === '') {
    return invalid('no comp given and no active comp');
  }
  return invalid(`comp not found: ${String(key)}`);
}

function checkLayerIndices(comp: Comp, indices: unknown): number[] {
  if (!Array.isArray(indices) || indices.length === 0) {
    return invalid('layers must be a non-empty array of layer indices');
  }
  for (const index of indices) {
    if (!isInteger(index) || index < 1 || index > comp.layers.length) {
      return invalid(`layer index out of range: ${String(index)}`);
    }
  }
  return indices as number[];
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function compOperationHandlers(project: FakeProject): HandlerMap {
  return {
    'comp.create': (raw) => {
      const a = asArgs(raw);
      const num = (value: unknown, fallback: number): number =>
        typeof value === 'number' ? value : fallback;
      const comp = project.addComp(
        nonEmptyString(a.name) ?? 'New Comp',
        num(a.width, 1920),
        num(a.height, 1080),
        num(a.fps, 30),
        { pixelAspect: num(a.pixelAspect, 1), duration: num(a.duration, 10) },
      );
      return compInfo(comp);
    },

    'comp.info': (raw) => compInfo(requireComp(project, asArgs(raw).comp)),

    'comp.duplicate': (raw) => {
      const a = asArgs(raw);
      const source = requireComp(project, a.comp);
      const copy = project.addComp(
        nonEmptyString(a.newName) ?? source.name,
        source.width,
        source.height,
        source.frameRate,
        { pixelAspect: source.pixelAspect, duration: source.duration, bgColor: [...source.bgColor] },
      );
      copy.layers = source.layers.map((layer) => ({ ...layer, id: project.newId() }));
      return compInfo(copy);
    },

    'comp.set_settings': (raw) => {
      const a = asArgs(raw);
      const comp = requireComp(project, a.comp);
      const hasColor = a.bgColor !== undefined && a.bgColor !== null;
      if (hasColor && (!Array.isArray(a.bgColor) || a.bgColor.length !== 3)) {
        invalid('bgColor must be [r, g, b] with values from 0 to 1');
      }
      let changed = 0;
      if (typeof a.width === 'number') {
        comp.width = a.width;
        changed += 1;
      }
      if (typeof a.height === 'number') {
        comp.height = a.height;
        changed += 1;
      }
      if (typeof a.pixelAspect === 'number') {
        comp.pixelAspect = a.pixelAspect;
        changed += 1;
      }
      if (typeof a.duration === 'number') {
        comp.duration = a.duration;
        changed += 1;
      }
      if (typeof a.fps === 'number') {
        comp.frameRate = a.fps;
        changed += 1;
      }
      if (hasColor) {
        const [r, g, b] = a.bgColor as [number, number, number];
        comp.bgColor = [r, g, b];
        changed += 1;
      }
      const newName = nonEmptyString(a.newName);
      if (newName !== undefined) {
        comp.name = newName;
        changed += 1;
      }
      if (changed === 0) {
        invalid('no settings to change');
      }
      return compInfo(comp);
    },

    'comp.precompose': (raw) => {
      const a = asArgs(raw);
      const comp = requireComp(project, a.comp);
      const indices = checkLayerIndices(comp, a.layers);
      if (a.moveAllAttributes === false && indices.length !== 1) {
        invalid('moveAllAttributes can only be false when exactly one layer is precomposed');
      }
      const name = nonEmptyString(a.name) ?? 'Pre-comp';
      const sorted = [...indices].sort((x, y) => x - y);
      const moved = sorted.map((index) => comp.layers[index - 1]!);
      const precomp = project.addComp(name, comp.width, comp.height, comp.frameRate, {
        pixelAspect: comp.pixelAspect,
        duration: comp.duration,
      });
      precomp.layers = moved;
      const holder = {
        id: project.newId(),
        name,
        inPoint: 0,
        outPoint: comp.duration,
        markers: [],
        expressions: [],
      };
      comp.layers = comp.layers.filter((layer) => !moved.includes(layer));
      comp.layers.splice(sorted[0]! - 1, 0, holder);
      return { comp: comp.name, numLayers: comp.layers.length, precomp: compInfo(precomp) };
    },

    // Trims layers to the frame range [from, to) at the comp's frame rate.
    'comp.layer_clip_frames': (raw) => {
      const a = asArgs(raw);
      const comp = requireComp(project, a.comp);
      if (!isInteger(a.from) || !isInteger(a.to) || a.from < 0 || a.to <= a.from) {
        invalid('from and to must be integer frames with 0 <= from < to');
      }
      const from = a.from as number;
      const to = a.to as number;
      const indices =
        a.layers === undefined || a.layers === null
          ? comp.layers.map((_, i) => i + 1)
          : checkLayerIndices(comp, a.layers);
      const frameDuration = 1 / comp.frameRate;
      const inPoint = from * frameDuration;
      const outPoint = to * frameDuration;
      for (const index of indices) {
        const layer = comp.layers[index - 1]!;
        layer.inPoint = round(inPoint);
        layer.outPoint = round(outPoint);
      }
      return { comp: comp.name, inPoint: round(inPoint), outPoint: round(outPoint), layers: indices };
    },
  };
}
