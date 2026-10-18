import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';

const POLYFILLS = readFileSync(join(__dirname, 'es3-polyfills.js'), 'utf8');

// ExtendScript lacks ES5 helpers; the polyfills must supply them when they are missing.
describe('ES3 polyfills', () => {
  it('adds Array.isArray when the engine has none', () => {
    const ctx = vm.createContext({});
    vm.runInContext('delete Array.isArray;', ctx);
    vm.runInContext(POLYFILLS, ctx);
    expect(vm.runInContext('[Array.isArray([1, 2]), Array.isArray({ length: 2 }), Array.isArray("ab")]', ctx)).toEqual([
      true,
      false,
      false,
    ]);
  });
});
