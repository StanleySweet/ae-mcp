import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';

const json2 = readFileSync(join(import.meta.dirname, 'es3-json2.js'), 'utf8');
const polyfills = readFileSync(join(import.meta.dirname, 'es3-polyfills.js'), 'utf8');

function run(probe: string): unknown {
  const sandbox: Record<string, unknown> = { JSON: undefined, result: undefined };
  vm.createContext(sandbox);
  vm.runInContext(`${json2}\n${polyfills}\n${probe}`, sandbox);
  return sandbox.result;
}

describe('json2 polyfill', () => {
  it('round trips a nested object', () => {
    const result = run(
      'result = JSON.parse(JSON.stringify({a: 1, b: [1, 2, {c: "x"}]}));',
    );
    expect(result).toEqual({ a: 1, b: [1, 2, { c: 'x' }] });
  });

  it('escapes quotes and unicode', () => {
    const result = run('result = JSON.stringify({a: "he said \\"hi\\"", b: "\u00e9"});');
    expect(result).toBe('{"a":"he said \\"hi\\"","b":"é"}');
  });

  it('rejects invalid JSON', () => {
    expect(() => run('result = JSON.parse("{not json}");')).toThrow();
  });
});

describe('Array and String polyfills in ES3 sandbox', () => {
  it('forEach iterates in order with index and array', () => {
    const result = run(
      'result = []; [3, 1, 2].forEach(function (v, i) { result.push(v + "-" + i); });',
    );
    expect(result).toEqual(['3-0', '1-1', '2-2']);
  });

  it('forEach honours thisArg', () => {
    const result = run(
      'var o = {suffix: "!"}; result = []; [1, 2].forEach(function (v) { result.push(v + this.suffix); }, o);',
    );
    expect(result).toEqual(['1!', '2!']);
  });

  it('map transforms each element', () => {
    const result = run('result = [1, 2, 3].map(function (v) { return v * 2; });');
    expect(result).toEqual([2, 4, 6]);
  });

  it('filter keeps matching elements', () => {
    const result = run('result = [1, 2, 3, 4].filter(function (v) { return v % 2 === 0; });');
    expect(result).toEqual([2, 4]);
  });

  it('indexOf finds the position and returns -1 when missing', () => {
    const result = run(`
      result = [];
      result.push([1, 2, 3].indexOf(2));
      result.push([1, 2, 3].indexOf(9));
    `);
    expect(result).toEqual([1, -1]);
  });

  it('trim removes surrounding whitespace', () => {
    const result = run('result = "  padded  ".trim();');
    expect(result).toBe('padded');
  });

  it('Object.keys returns own enumerable properties only', () => {
    const result = run(`
      function C() { this.own = 1; }
      C.prototype.inherited = 2;
      result = Object.keys(new C()).join(",");
    `);
    expect(result).toBe('own');
  });
});