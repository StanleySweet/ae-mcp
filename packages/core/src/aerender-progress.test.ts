import { describe, it, expect } from 'vitest';
import { parseAerenderLine } from './aerender-progress.js';

describe('parseAerenderLine', () => {
  it('parses a per-frame progress line', () => {
    expect(parseAerenderLine('PROGRESS: 00015 (16): 3 Seconds')).toEqual({
      type: 'progress',
      frame: 15,
      rendered: 16,
      seconds: 3,
    });
  });

  it('parses the launching, version and error lines', () => {
    expect(parseAerenderLine('PROGRESS: Launching After Effects...')).toEqual({ type: 'launching' });
    expect(parseAerenderLine('aerender version 24.0.0x78')).toEqual({
      type: 'version',
      version: '24.0.0x78',
    });
    expect(parseAerenderLine('aerender ERROR -1701: AEGetParamPt failed')).toEqual({
      type: 'error',
      message: 'aerender ERROR -1701: AEGetParamPt failed',
    });
  });

  it('ignores setting noise and blank lines', () => {
    expect(parseAerenderLine('PROGRESS: Output Module: Lossless')).toBeNull();
    expect(parseAerenderLine('   ')).toBeNull();
    expect(parseAerenderLine('')).toBeNull();
  });

  it('tolerates carriage returns and leading whitespace', () => {
    expect(parseAerenderLine('  PROGRESS: 00000 (1): 0 Seconds\r')).toEqual({
      type: 'progress',
      frame: 0,
      rendered: 1,
      seconds: 0,
    });
  });
});
