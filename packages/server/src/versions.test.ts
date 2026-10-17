import { describe, it, expect } from 'vitest';
import { buildVersions, formatForPath, parseCsv, parseDataRows } from './versions.js';

describe('parseCsv', () => {
  it('reads a header row and quoted fields with commas, quotes and line breaks', () => {
    const rows = parseCsv('name,title\r\nanna,"Hello, ""Anna"""\r\nben,"two\nlines"\r\n');
    expect(rows).toEqual([
      ['name', 'title'],
      ['anna', 'Hello, "Anna"'],
      ['ben', 'two\nlines'],
    ]);
  });

  it('refuses an unterminated quoted field', () => {
    expect(() => parseCsv('name\n"open')).toThrow(/unterminated/);
  });
});

describe('parseDataRows', () => {
  it('turns CSV records into objects keyed by the header', () => {
    const rows = parseDataRows('name,title\nanna,Hello\nben,Hi\n', 'csv');
    expect(rows).toEqual([
      { name: 'anna', title: 'Hello' },
      { name: 'ben', title: 'Hi' },
    ]);
  });

  it('refuses a CSV row with the wrong number of fields', () => {
    expect(() => parseDataRows('name,title\nanna\n', 'csv')).toThrow(/row 2/);
  });

  it('accepts JSON arrays of objects and stringifies plain values', () => {
    const rows = parseDataRows('[{"name":"anna","count":3,"ok":true}]', 'json');
    expect(rows).toEqual([{ name: 'anna', count: '3', ok: 'true' }]);
  });

  it('refuses JSON that is not an array of objects', () => {
    expect(() => parseDataRows('{"name":"anna"}', 'json')).toThrow(/array/);
    expect(() => parseDataRows('[["anna"]]', 'json')).toThrow(/object/);
  });
});

describe('formatForPath', () => {
  it('picks the format from the extension', () => {
    expect(formatForPath('/data/rows.csv')).toBe('csv');
    expect(formatForPath('/data/rows.JSON')).toBe('json');
    expect(formatForPath('/data/rows.txt')).toBeNull();
  });
});

describe('buildVersions', () => {
  const rows = [
    { name: 'Anna', title: 'Hello Anna', photo: '/media/a.png' },
    { name: 'Ben', title: 'Hello Ben', photo: '/media/b.png' },
  ];

  it('maps columns onto layer names, one version per row', () => {
    const versions = buildVersions(rows, [
      { layer: 'Title', text: 'title' },
      { layer: 'Photo', footage: 'photo' },
    ], 'name');
    expect(versions).toEqual([
      { name: 'Anna', texts: { Title: 'Hello Anna' }, footage: { Photo: '/media/a.png' } },
      { name: 'Ben', texts: { Title: 'Hello Ben' }, footage: { Photo: '/media/b.png' } },
    ]);
  });

  it('names versions by position when no name column is given', () => {
    const versions = buildVersions(rows, [{ layer: 'Title', text: 'title' }]);
    expect(versions.map((v) => v.name)).toEqual(['version 1', 'version 2']);
  });

  it('refuses a column the rows do not have', () => {
    expect(() => buildVersions(rows, [{ layer: 'Title', text: 'missing' }])).toThrow(/column 'missing'/);
  });

  it('refuses an empty mapping and a mapping entry with no column', () => {
    expect(() => buildVersions(rows, [])).toThrow(/mapping/);
    expect(() => buildVersions(rows, [{ layer: 'Title' }])).toThrow(/text or footage/);
  });

  it('refuses duplicate version names', () => {
    const dup = [{ name: 'Anna', title: 'a' }, { name: 'Anna', title: 'b' }];
    expect(() => buildVersions(dup, [{ layer: 'Title', text: 'title' }], 'name')).toThrow(/duplicate/);
  });

  it('refuses no rows', () => {
    expect(() => buildVersions([], [{ layer: 'Title', text: 'title' }])).toThrow(/no rows/);
  });
});
