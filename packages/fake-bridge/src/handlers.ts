import type { HandlerMap } from './consumer.js';
import type { Comp, FakeProject } from './project.js';

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

/** Read-only observe handlers backed by the in-memory fake project. */
export function observeHandlers(project: FakeProject): HandlerMap {
  return {
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
  };
}