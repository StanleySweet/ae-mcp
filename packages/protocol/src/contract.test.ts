import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { jobSchema, resultSchema } from './messages.js';

// Shared fixtures: the native Setup app (C#) asserts the same files, so a drift
// in the job/result shape fails both suites (see the native-installer design).
const dir = dirname(fileURLToPath(import.meta.url));
const job = JSON.parse(readFileSync(join(dir, '..', 'contract', 'job.json'), 'utf8'));
const result = JSON.parse(readFileSync(join(dir, '..', 'contract', 'result.json'), 'utf8'));

describe('bridge protocol contract fixtures', () => {
  it('job.json satisfies the JobMessage schema', () => {
    expect(() => jobSchema.parse(job)).not.toThrow();
  });

  it('result.json satisfies the ResultMessage schema', () => {
    expect(() => resultSchema.parse(result)).not.toThrow();
  });

  it('job.json carries exactly the fields the native BridgeCall writes', () => {
    expect(Object.keys(job).sort()).toEqual(['args', 'deadline', 'id', 'protocolVersion', 'tool']);
  });
});
