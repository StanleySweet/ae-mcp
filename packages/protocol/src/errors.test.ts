import { describe, it, expect } from 'vitest';
import {
  errorCodes,
  errorHints,
  makeError,
  type ErrorCode,
} from './errors.js';
import { resultSchema, PROTOCOL_VERSION } from './messages.js';

describe('error codes', () => {
  it('has a non-empty hint for every code', () => {
    for (const code of errorCodes) {
      expect(errorHints[code as ErrorCode].length).toBeGreaterThan(0);
    }
  });

  it('exposes the core codes the transports and server need', () => {
    for (const code of ['AE_NOT_RUNNING', 'BRIDGE_NOT_LOADED', 'TIMEOUT', 'SCRIPT_ERROR', 'INVALID_MESSAGE']) {
      expect(errorCodes).toContain(code);
    }
  });

  it('makeError attaches the hint for a code', () => {
    const err = makeError('TIMEOUT', 'job exceeded deadline');
    expect(err).toEqual({ code: 'TIMEOUT', message: 'job exceeded deadline', hint: errorHints.TIMEOUT });
  });
});

describe('typed error code in result message', () => {
  it('rejects an unknown error code', () => {
    expect(() =>
      resultSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: { code: 'BOGUS_CODE', message: 'nope' },
      }),
    ).toThrow();
  });

  it('accepts a known error code', () => {
    const result = resultSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      ok: false,
      error: { code: 'AE_NOT_RUNNING', message: 'no AE' },
    });
    if (result.ok) throw new Error('expected a failure result');
    expect(result.error.code).toBe('AE_NOT_RUNNING');
  });
});