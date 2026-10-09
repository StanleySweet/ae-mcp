import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Linter } from 'eslint';
import { describe, it, expect } from 'vitest';
// @ts-expect-error: plain JS flat config, no declaration file
import es3Config from '../es3-lint.config.js';

function lintES3(code: string): Linter.LintMessage[] {
  const linter = new Linter({ configType: 'flat' });
  return linter.verify(code, es3Config);
}

describe('es3 syntax lint', () => {
  it('accepts the polyfill sources', () => {
    for (const name of ['es3-polyfills.js', 'es3-json2.js']) {
      const code = readFileSync(join(import.meta.dirname, name), 'utf8');
      expect(lintES3(code), name).toEqual([]);
    }
  });

  it('rejects const', () => {
    expect(lintES3('const x = 1;').some((m) => m.fatal)).toBe(true);
  });

  it('rejects arrow functions', () => {
    expect(lintES3('var f = () => 1;').some((m) => m.fatal)).toBe(true);
  });

  it('rejects template strings', () => {
    expect(lintES3('var s = `hi ${1}`;').some((m) => m.fatal)).toBe(true);
  });

  it('accepts var and plain functions', () => {
    expect(lintES3('var n = function (a) { return a + 1; };')).toEqual([]);
  });
});