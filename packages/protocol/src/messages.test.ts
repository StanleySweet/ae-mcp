import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  jobSchema,
  heartbeatSchema,
  resultSchema,
} from './messages.js';

describe('job message', () => {
  it('parses a valid job', () => {
    const job = jobSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      id: 'job-1',
      tool: 'layer.add',
      args: { name: 'Solid' },
      deadline: 1_700_000_000_000,
    });
    expect(job.id).toBe('job-1');
    expect(job.tool).toBe('layer.add');
  });

  it('rejects a job without protocolVersion', () => {
    expect(() =>
      jobSchema.parse({ id: 'job-1', tool: 'layer.add', args: {}, deadline: 1 }),
    ).toThrow();
  });

  it('rejects a job with a non-string id', () => {
    expect(() =>
      jobSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        id: 7,
        tool: 'layer.add',
        args: {},
        deadline: 1,
      }),
    ).toThrow();
  });
});

describe('heartbeat message', () => {
  it('parses a valid heartbeat', () => {
    const beat = heartbeatSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      bridgeVersion: '1.2.3',
      aeVersion: '2026',
      os: 'darwin',
      capabilities: ['layer.add', 'comp.add'],
      busy: false,
      transport: 'osascript',
    });
    expect(beat.capabilities).toEqual(['layer.add', 'comp.add']);
  });

  it('rejects a heartbeat without busy', () => {
    expect(() =>
      heartbeatSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        bridgeVersion: '1.2.3',
        aeVersion: '2026',
        os: 'darwin',
        capabilities: [],
        transport: 'osascript',
      }),
    ).toThrow();
  });
});

describe('result message', () => {
  it('parses a successful result', () => {
    const result = resultSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      result: { layerId: 2 },
    });
    expect(result.ok).toBe(true);
  });

  it('parses a failed result with error and hint', () => {
    const result = resultSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      ok: false,
      error: { code: 'AE_NOT_RUNNING', message: 'AE does not exist', hint: 'Launch AE' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects ok:false without an error', () => {
    expect(() =>
      resultSchema.parse({ protocolVersion: PROTOCOL_VERSION, ok: false }),
    ).toThrow();
  });

  it('rejects a result without ok', () => {
    expect(() =>
      resultSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        result: { layerId: 2 },
      }),
    ).toThrow();
  });
});