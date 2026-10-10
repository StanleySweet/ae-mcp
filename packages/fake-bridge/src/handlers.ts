import type { HandlerMap } from './consumer.js';
import type { Comp, CompLayer, FakeProject } from './project.js';

function compInfo(comp: Comp): Record<string, unknown> {
  return {
    id: comp.id,
    name: comp.name,
    type: 'Composition',
    parentFolderId: 0,
    parentFolderName: 'Root',
    label: 0,
    comment: '',
    width: comp.width,
    height: comp.height,
    pixelAspect: 1,
    frameRate: comp.frameRate,
    duration: 0,
    bgColor: [0, 0, 0],
    numLayers: comp.layers.length,
    workAreaStart: 0,
    workAreaDuration: 0,
    motionBlur: false,
  };
}

function requestedComps(args: unknown): (string | number)[] {
  const comps = (args as { comps?: unknown } | null)?.comps;
  return Array.isArray(comps) ? (comps as (string | number)[]) : [];
}

function findComp(project: FakeProject, key: unknown): Comp | undefined {
  if (key === undefined || key === null || key === '') {
    return project.comps[0];
  }
  return project.comps.find((comp) =>
    typeof key === 'number' ? comp.id === key : comp.name === key,
  );
}

function layerInfo(layer: CompLayer, index: number): Record<string, unknown> {
  return {
    index,
    id: layer.id,
    name: layer.name,
    type: 'AVLayer',
    enabled: true,
    solo: false,
    shy: false,
    locked: false,
    inPoint: 0,
    outPoint: 0,
    startTime: 0,
    stretch: 1,
    parentIndex: null,
    label: 0,
  };
}

/** Read-only observe handlers backed by the in-memory fake project. */
export function observeHandlers(project: FakeProject): HandlerMap {
  const handlers: HandlerMap = {
    ae_project_info: () => ({
      file: null,
      numItems: project.comps.length,
      bitsPerChannel: 8,
      activeItem: null,
      items: project.comps.map((comp) => ({
        id: comp.id,
        name: comp.name,
        type: 'Composition',
        parentFolderId: 0,
        parentFolderName: 'Root',
        label: 0,
        comment: '',
      })),
    }),
    ae_comp_info: (args) => {
      const requested = requestedComps(args);
      if (requested.length === 0) {
        return { comps: project.comps.map(compInfo), missing: [] };
      }
      const comps: Record<string, unknown>[] = [];
      const missing: (string | number)[] = [];
      for (const key of requested) {
        const match = project.comps.find((comp) =>
          typeof key === 'number' ? comp.id === key : comp.name === key,
        );
        if (match) {
          comps.push(compInfo(match));
        } else {
          missing.push(key);
        }
      }
      return { comps, missing };
    },
    ae_layer_info: (args) => {
      const parsed = (args ?? {}) as { comp?: unknown; layers?: unknown };
      const comp = findComp(project, parsed.comp);
      if (!comp) {
        return { comp: null, layers: [], missing: [] };
      }
      if (!Array.isArray(parsed.layers)) {
        const layers = comp.layers.map((layer, i) => layerInfo(layer, i + 1));
        return { comp: comp.name, layers, missing: [] };
      }
      const layers: Record<string, unknown>[] = [];
      const missing: number[] = [];
      for (const index of parsed.layers as number[]) {
        if (index >= 1 && index <= comp.layers.length) {
          layers.push(layerInfo(comp.layers[index - 1]!, index));
        } else {
          missing.push(index);
        }
      }
      return { comp: comp.name, layers, missing };
    },
  };
  handlers.ae_version_info = () => ({
    aeVersion: '24.6.0',
    bridgeVersion: '0.0.0',
    capabilities: Object.keys(handlers).sort(),
  });
  handlers.get_selection = () => ({
    comp: project.comps[0]?.name ?? null,
    layers: project.selection.map((layer, i) => layerInfo(layer, i + 1)),
    items: [],
  });
  return handlers;
}