import { describe, it, expect } from 'vitest';
import { compOperationHandlers } from './comp-ops.js';
import { FakeProject } from './project.js';

function setup(layerCount = 0) {
  const project = new FakeProject();
  const comp = project.addComp('Main', 1920, 1080, 25, { duration: 10 });
  for (let i = 1; i <= layerCount; i += 1) {
    project.addLayer(comp, `Layer ${i}`);
  }
  const handlers = compOperationHandlers(project);
  const call = (tool: string, args: unknown): Record<string, unknown> =>
    handlers[tool]!(args) as Record<string, unknown>;
  return { project, comp, call };
}

function failure(run: () => unknown): { code?: string; message: string } {
  try {
    run();
  } catch (error) {
    return error as { code?: string; message: string };
  }
  throw new Error('expected the handler to throw');
}

describe('fake comp operations', () => {
  it('registers exactly the comp operations', () => {
    const { project } = setup();
    expect(Object.keys(compOperationHandlers(project)).sort()).toEqual([
      'comp.create',
      'comp.duplicate',
      'comp.info',
      'comp.layer_clip_frames',
      'comp.precompose',
      'comp.set_settings',
    ]);
  });

  it('comp.create defaults to 1920x1080 30 fps 10 s and honours settings', () => {
    const { project, call } = setup();
    expect(call('comp.create', { name: 'Intro' })).toMatchObject({
      name: 'Intro',
      width: 1920,
      height: 1080,
      pixelAspect: 1,
      frameRate: 30,
      duration: 10,
      numLayers: 0,
    });
    expect(call('comp.create', { name: 'V', width: 1080, height: 1920, duration: 5, fps: 24 }))
      .toMatchObject({ width: 1080, height: 1920, frameRate: 24, duration: 5 });
    expect(project.comps).toHaveLength(3);
  });

  it('comp.info finds by name, id and falls back to the first comp', () => {
    const { comp, call } = setup();
    expect(call('comp.info', { comp: 'Main' })).toMatchObject({ name: 'Main' });
    expect(call('comp.info', { comp: comp.id })).toMatchObject({ name: 'Main' });
    expect(call('comp.info', {})).toMatchObject({ name: 'Main' });
    const error = failure(() => call('comp.info', { comp: 'Nope' }));
    expect(error.code).toBe('INVALID_ARGS');
    expect(error.message).toContain('Nope');
  });

  it('comp.duplicate copies settings and layers and can rename the copy', () => {
    const { project, comp, call } = setup(2);
    const copy = call('comp.duplicate', { comp: 'Main', newName: 'Main B' });
    expect(copy).toMatchObject({ name: 'Main B', numLayers: 2, width: 1920 });
    expect(project.comps).toHaveLength(2);
    expect(comp.name).toBe('Main');
    expect(project.comps[1]!.layers.map((l) => l.id)).not.toEqual(comp.layers.map((l) => l.id));
    expect(failure(() => call('comp.duplicate', { comp: 'Nope' })).code).toBe('INVALID_ARGS');
  });

  it('comp.set_settings changes only what is provided', () => {
    const { comp, call } = setup();
    const info = call('comp.set_settings', {
      comp: 'Main',
      width: 1280,
      height: 720,
      fps: 24,
      bgColor: [1, 0.5, 0],
      newName: 'Main v2',
    });
    expect(info).toMatchObject({ name: 'Main v2', width: 1280, height: 720, frameRate: 24 });
    expect(comp.duration).toBe(10);
    expect(comp.bgColor).toEqual([1, 0.5, 0]);
    expect(failure(() => call('comp.set_settings', { comp: 'Main v2' })).code).toBe(
      'INVALID_ARGS',
    );
    expect(failure(() => call('comp.set_settings', { comp: 'Main v2', bgColor: [1] })).code).toBe(
      'INVALID_ARGS',
    );
  });

  it('comp.precompose moves layers into a new comp and leaves one precomp layer', () => {
    const { project, comp, call } = setup(4);
    const result = call('comp.precompose', { comp: 'Main', layers: [2, 3], name: 'Inner' });
    expect(result).toMatchObject({
      comp: 'Main',
      numLayers: 3,
      precomp: { name: 'Inner', numLayers: 2 },
    });
    expect(comp.layers.map((l) => l.name)).toEqual(['Layer 1', 'Inner', 'Layer 4']);
    expect(project.comps).toHaveLength(2);
  });

  it('comp.precompose validates layers and moveAllAttributes', () => {
    const { call } = setup(3);
    for (const layers of [[], [4], [0], [1.5]]) {
      expect(failure(() => call('comp.precompose', { comp: 'Main', layers })).code).toBe(
        'INVALID_ARGS',
      );
    }
    expect(
      failure(() =>
        call('comp.precompose', { comp: 'Main', layers: [1, 2], moveAllAttributes: false }),
      ).code,
    ).toBe('INVALID_ARGS');
    expect(call('comp.precompose', { comp: 'Main', layers: [1], moveAllAttributes: false }))
      .toMatchObject({ precomp: { name: 'Pre-comp' } });
  });

  it('comp.layer_clip_frames trims to [from, to) at the comp frame rate', () => {
    const { comp, call } = setup(3);
    expect(call('comp.layer_clip_frames', { comp: 'Main', from: 10, to: 50 })).toMatchObject({
      comp: 'Main',
      inPoint: 0.4,
      outPoint: 2,
      layers: [1, 2, 3],
    });
    expect(comp.layers.map((l) => [l.inPoint, l.outPoint])).toEqual([
      [0.4, 2],
      [0.4, 2],
      [0.4, 2],
    ]);
    call('comp.layer_clip_frames', { comp: 'Main', layers: [2], from: 0, to: 25 });
    expect(comp.layers[1]).toMatchObject({ inPoint: 0, outPoint: 1 });
    expect(comp.layers[0]).toMatchObject({ inPoint: 0.4, outPoint: 2 });
  });

  it('comp.layer_clip_frames rejects a missing or empty range and bad layer indices', () => {
    const { call } = setup(1);
    for (const args of [
      { comp: 'Main' },
      { comp: 'Main', from: 10 },
      { comp: 'Main', from: 10, to: 10 },
      { comp: 'Main', from: -1, to: 10 },
      { comp: 'Main', from: 0, to: 10, layers: [2] },
    ]) {
      expect(failure(() => call('comp.layer_clip_frames', args)).code).toBe('INVALID_ARGS');
    }
  });
});
