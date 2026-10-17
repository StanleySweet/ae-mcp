// Data-driven versions (#239): parse CSV or JSON rows on the server and map their
// columns onto template layers. The bridge only ever receives plain strings.

export type VersionRow = Record<string, string>;

export interface VersionMapping {
  /** Template layer name. */
  layer: string;
  /** Column whose value replaces this layer's Source Text. */
  text?: string;
  /** Column whose value is the file path of this layer's new footage. */
  footage?: string;
}

export interface PlainVersion {
  name: string;
  texts: Record<string, string>;
  footage: Record<string, string>;
}

export type DataFormat = 'csv' | 'json';

/** The data format a file path implies, or null for an unknown extension. */
export function formatForPath(path: string): DataFormat | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.json')) return 'json';
  return null;
}

/** RFC 4180-style CSV: quoted fields may hold commas, doubled quotes and line breaks. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
    i += 1;
  }
  if (quoted) {
    throw new Error('CSV has an unterminated quoted field');
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ''));
}

/** Rows as objects keyed by column name. The CSV header is the first record. */
export function parseDataRows(input: string, format: DataFormat): VersionRow[] {
  if (format === 'json') {
    const parsed: unknown = JSON.parse(input);
    if (!Array.isArray(parsed)) {
      throw new Error('JSON data must be an array of objects');
    }
    return parsed.map((entry, index) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`JSON row ${index + 1} must be an object`);
      }
      const row: VersionRow = {};
      for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
        row[key] = String(value ?? '');
      }
      return row;
    });
  }
  const records = parseCsv(input);
  const header = records[0];
  if (header === undefined) {
    return [];
  }
  return records.slice(1).map((cells, index) => {
    if (cells.length !== header.length) {
      throw new Error(`CSV row ${index + 2} has ${cells.length} fields, the header has ${header.length}`);
    }
    const row: VersionRow = {};
    header.forEach((column, col) => {
      row[column] = cells[col] ?? '';
    });
    return row;
  });
}

/**
 * One version per row. `nameColumn` names the version (default "version N");
 * each mapping entry copies a column into the text or footage of a layer.
 * Throws an Error with a plain message when the input cannot be mapped.
 */
export function buildVersions(
  rows: VersionRow[],
  mapping: VersionMapping[],
  nameColumn?: string,
): PlainVersion[] {
  if (rows.length === 0) {
    throw new Error('no rows to build versions from');
  }
  if (mapping.length === 0) {
    throw new Error('mapping needs at least one entry');
  }
  for (const entry of mapping) {
    if (entry.text === undefined && entry.footage === undefined) {
      throw new Error(`mapping for layer '${entry.layer}' needs a text or footage column`);
    }
  }
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const texts: Record<string, string> = {};
    const footage: Record<string, string> = {};
    for (const entry of mapping) {
      if (entry.text !== undefined) {
        texts[entry.layer] = column(row, entry.text, index);
      }
      if (entry.footage !== undefined) {
        footage[entry.layer] = column(row, entry.footage, index);
      }
    }
    const name = nameColumn === undefined ? `version ${index + 1}` : column(row, nameColumn, index);
    if (name === '') {
      throw new Error(`row ${index + 1} has an empty version name`);
    }
    if (seen.has(name)) {
      throw new Error(`duplicate version name '${name}'`);
    }
    seen.add(name);
    return { name, texts, footage };
  });
}

function column(row: VersionRow, name: string, index: number): string {
  const value = row[name];
  if (value === undefined) {
    throw new Error(`row ${index + 1} has no column '${name}'`);
  }
  return value;
}
