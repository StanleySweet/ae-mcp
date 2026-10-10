import type { HandlerMap } from './consumer.js';
import type { FakeProject } from './project.js';

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
  };
}