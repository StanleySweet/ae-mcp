import { describe, expect, it } from 'vitest';
import { checkEs3 } from './es3-check.js';

function offenceLine(source: string): number | null {
  const result = checkEs3(source);
  if (result.ok) throw new Error(`expected an offence in: ${source}`);
  return result.line;
}

describe('checkEs3', () => {
  it('accepts plain ES3 with var, function and string concatenation', () => {
    const source = [
      'var name = "a" + \'b\';',
      'function offset(n) {',
      '  var layers = app.project.activeItem.selectedLayers;',
      '  for (var i = 0; i < layers.length; i++) { layers[i].startTime += n; }',
      '}',
      'offset(2);',
    ].join('\n');
    expect(checkEs3(source)).toEqual({ ok: true });
  });

  it('refuses let and names the line', () => {
    expect(checkEs3('var a = 1;\nlet b = 2;\n')).toMatchObject({ ok: false, line: 2 });
  });

  it('refuses const and names the line', () => {
    expect(offenceLine('var a = 1;\n\nconst b = 2;')).toBe(3);
  });

  it('refuses an arrow function', () => {
    expect(offenceLine('var f = 1;\nvar g = (x) => x + 1;')).toBe(2);
  });

  it('refuses a template literal', () => {
    expect(offenceLine('var a = 1;\nvar s = `value ${a}`;')).toBe(2);
  });

  it('refuses a class declaration', () => {
    expect(offenceLine('var a;\nclass Thing {}')).toBe(2);
  });

  it('refuses spread', () => {
    expect(offenceLine('var a = [1];\nvar b = [...a];')).toBe(2);
  });

  it('reports the first offence in source order', () => {
    expect(offenceLine('const a = 1;\nvar f = () => 1;')).toBe(1);
  });

  it('ignores the forbidden words inside strings and comments', () => {
    const source = [
      '// let x = 1; const y = 2;',
      '/* class A {} ... () => 3 */',
      'var s = "let me say => and ... const";',
      "var t = 'class `tick` ...';",
      'var u = "escaped \\" let\\" quote";',
    ].join('\n');
    expect(checkEs3(source)).toEqual({ ok: true });
  });

  it('ignores the forbidden words inside regex literals', () => {
    expect(checkEs3('var re = /=>|\\.\\.\\.|let x/g;\nvar ok = re.test("a");')).toEqual({ ok: true });
  });

  it('does not flag let or class used as a property name', () => {
    expect(checkEs3('var o = {};\no.let = 1;\no.class = 2;\no.const = 3;')).toEqual({ ok: true });
  });

  it('keeps the line count across a multi-line comment', () => {
    expect(offenceLine('/* one\ntwo\nthree */\nconst a = 1;')).toBe(4);
  });

  it('refuses source that does not parse, with its line', () => {
    const result = checkEs3('var a = 1;\nvar b = ;\n');
    expect(result).toMatchObject({ ok: false, line: 2 });
    expect(result.ok === false && result.message).toMatch(/does not parse/);
  });

  it('refuses a source with an unclosed brace', () => {
    expect(checkEs3('function f() {\n  var a = 1;\n')).toMatchObject({ ok: false });
  });
});
