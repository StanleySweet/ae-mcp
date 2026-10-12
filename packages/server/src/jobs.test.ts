import { describe, it, expect } from 'vitest';
import { JobStore } from './jobs.js';

describe('JobStore', () => {
  it('starts a running job with a unique id', () => {
    const store = new JobStore();
    const first = store.start('render');
    const second = store.start('render');
    expect(first).not.toBe(second);
    expect(store.get(first)).toMatchObject({ id: first, kind: 'render', status: 'running' });
    expect(store.list()).toHaveLength(2);
  });

  it('records progress only while running', () => {
    const store = new JobStore();
    const id = store.start('render');
    store.progress(id, { frame: 3, rendered: 10, seconds: 2 });
    expect(store.get(id)?.progress).toEqual({ frame: 3, rendered: 10, seconds: 2 });
    store.succeed(id);
    store.progress(id, { frame: 9, rendered: 10, seconds: 8 });
    expect(store.get(id)?.progress).toEqual({ frame: 3, rendered: 10, seconds: 2 });
  });

  it('marks a job succeeded with a result and a finish time', () => {
    const store = new JobStore();
    const id = store.start('render');
    store.succeed(id, { exitCode: 0 });
    const record = store.get(id);
    expect(record?.status).toBe('succeeded');
    expect(record?.result).toEqual({ exitCode: 0 });
    expect(record?.finishedAt).toBeTypeOf('number');
  });

  it('marks a job failed with an error', () => {
    const store = new JobStore();
    const id = store.start('render');
    store.fail(id, 'aerender exited with code 1');
    expect(store.get(id)).toMatchObject({ status: 'failed', error: 'aerender exited with code 1' });
  });

  it('marks a job cancelled', () => {
    const store = new JobStore();
    const id = store.start('render');
    store.cancel(id);
    expect(store.get(id)?.status).toBe('cancelled');
  });

  it('ignores finish calls on an already-finished job', () => {
    const store = new JobStore();
    const id = store.start('render');
    store.succeed(id, 1);
    store.fail(id, 'boom');
    expect(store.get(id)).toMatchObject({ status: 'succeeded', result: 1 });
    expect(store.get(id)?.error).toBeUndefined();
  });

  it('returns copies so callers cannot mutate the store', () => {
    const store = new JobStore();
    const id = store.start('render');
    const record = store.get(id)!;
    record.status = 'failed';
    expect(store.get(id)?.status).toBe('running');
  });

  it('evicts the oldest finished jobs beyond maxFinished but keeps running ones', () => {
    const store = new JobStore({ maxFinished: 2 });
    const running = store.start('render');
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const id = store.start('render');
      ids.push(id);
      store.succeed(id, index);
    }
    expect(store.get(ids[0]!)).toBeUndefined();
    expect(store.get(ids[2]!)).toBeDefined();
    expect(store.get(running)?.status).toBe('running');
  });

  it('returns undefined for an unknown id', () => {
    expect(new JobStore().get('job-nope')).toBeUndefined();
  });
});
