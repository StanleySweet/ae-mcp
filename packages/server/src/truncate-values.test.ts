import { describe, it, expect } from 'vitest';
import { truncateLongStrings } from './truncate-values.js';

describe('truncateLongStrings', () => {
  it('returns strings under the limit unchanged and without flags', () => {
    const value = { text: 'short', nested: { body: 'x'.repeat(10) } };

    expect(truncateLongStrings(value, 10)).toEqual({ text: 'short', nested: { body: 'x'.repeat(10) } });
  });

  it('cuts a long string and reports its full length beside it', () => {
    const out = truncateLongStrings({ text: 'abcdefghij' }, 4);

    expect(out).toEqual({ text: 'abcd', textTruncated: true, textLength: 10 });
  });

  it('cuts long strings inside arrays and nested objects', () => {
    const out = truncateLongStrings([{ doc: { text: 'x'.repeat(7) } }], 5);

    expect(out).toEqual([{ doc: { text: 'xxxxx', textTruncated: true, textLength: 7 } }]);
  });

  it('leaves non-string values alone', () => {
    expect(truncateLongStrings({ n: 12, b: true, nil: null, list: [1, 2] })).toEqual({
      n: 12,
      b: true,
      nil: null,
      list: [1, 2],
    });
  });
});
