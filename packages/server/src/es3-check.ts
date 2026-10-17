import { Script } from 'node:vm';

/** The result of `checkEs3`: ok, or the first offence with its 1-based line (null when unknown). */
export type Es3Result = { ok: true } | { ok: false; line: number | null; message: string };

interface Token {
  kind: 'word' | 'punct' | 'number' | 'regex';
  text: string;
  line: number;
}

/** Words after which a `/` starts a regex literal rather than a division. */
const REGEX_AFTER_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield',
]);

/**
 * Checks that `source` parses (`node:vm` `Script`, compiled and never run) and uses no
 * syntax ExtendScript (ES3) does not run: `let`, `const`, `=>`, backtick templates,
 * `class` and spread `...`. Returns the first offence in source order.
 *
 * shortcut: a heuristic, not a parser. `let`/`const` are caught by their keyword spelling
 * (a `let` used as a plain identifier is not flagged); regex literals are found from the
 * previous token, so `/` after `}` is read as division (a regex there is missed); ES2015+
 * syntax other than the listed forms (e.g. `try {} catch {}`, default parameters) is not flagged.
 */
export function checkEs3(source: string): Es3Result {
  try {
    // The name is only used in the SyntaxError stack; nothing is executed.
    new Script(source, { filename: 'ae-source.jsx' });
  } catch (error) {
    if (error instanceof SyntaxError) {
      const match = /ae-source\.jsx:(\d+)/.exec(error.stack ?? '');
      return { ok: false, line: match ? Number(match[1]) : null, message: `source does not parse: ${error.message}` };
    }
    throw error;
  }

  const tokens = tokenize(source);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const previous = i > 0 ? tokens[i - 1] : undefined;
    const afterDot = previous !== undefined && previous.kind === 'punct' && previous.text === '.';
    if (token.kind === 'word' && !afterDot) {
      if (token.text === 'const') {
        return offence(token.line, 'const is not ES3; declare the value with var');
      }
      if (token.text === 'let') {
        const next = tokens[i + 1];
        if (next !== undefined && (next.kind === 'word' || next.text === '[' || next.text === '{')) {
          return offence(token.line, 'let is not ES3; declare the value with var');
        }
      }
      if (token.text === 'class') {
        return offence(token.line, 'class is not ES3; use a function and prototype');
      }
    }
    if (token.kind === 'punct' && token.text === '=>') {
      return offence(token.line, 'arrow functions (=>) are not ES3; use function');
    }
    if (token.kind === 'punct' && token.text === '...') {
      return offence(token.line, 'spread and rest (...) are not ES3');
    }
    if (token.kind === 'punct' && token.text === '`') {
      return offence(token.line, 'template literals (backticks) are not ES3; use string concatenation');
    }
  }
  return { ok: true };
}

function offence(line: number, message: string): Es3Result {
  return { ok: false, line, message };
}

function isWordStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch) || ch.charCodeAt(0) > 127;
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch) || ch.charCodeAt(0) > 127;
}

/** Significant tokens only: strings and comments are skipped, a template backtick is kept as a punct token. */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '\n') {
      line++;
      i++;
    } else if (/\s/.test(ch)) {
      i++;
    } else if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      line += countNewlines(source, i, stop);
      i = stop;
    } else if (ch === '"' || ch === "'") {
      i = skipString(source, i, ch, () => line++);
    } else if (ch === '/' && startsRegex(tokens)) {
      const stop = regexEnd(source, i);
      if (stop !== -1) {
        tokens.push({ kind: 'regex', text: source.slice(i, stop), line });
        i = stop;
      } else {
        tokens.push({ kind: 'punct', text: '/', line });
        i++;
      }
    } else if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next ?? ''))) {
      let stop = i + 1;
      while (stop < source.length && /[0-9A-Za-z_.]/.test(source[stop])) stop++;
      tokens.push({ kind: 'number', text: source.slice(i, stop), line });
      i = stop;
    } else if (isWordStart(ch)) {
      let stop = i + 1;
      while (stop < source.length && isWordChar(source[stop])) stop++;
      tokens.push({ kind: 'word', text: source.slice(i, stop), line });
      i = stop;
    } else if (ch === '.' && next === '.' && source[i + 2] === '.') {
      tokens.push({ kind: 'punct', text: '...', line });
      i += 3;
    } else if (ch === '=' && next === '>') {
      tokens.push({ kind: 'punct', text: '=>', line });
      i += 2;
    } else {
      tokens.push({ kind: 'punct', text: ch, line });
      i++;
    }
  }
  return tokens;
}

function countNewlines(source: string, from: number, to: number): number {
  let count = 0;
  for (let k = from; k < to; k++) {
    if (source[k] === '\n') count++;
  }
  return count;
}

/** Skips a string literal starting at `start`; a bare newline ends it (unterminated). Returns the index after it. */
function skipString(source: string, start: number, quote: string, onNewline: () => void): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      if (source[i + 1] === '\n') onNewline();
      i += 2;
    } else if (ch === quote) {
      return i + 1;
    } else if (ch === '\n') {
      return i;
    } else {
      i++;
    }
  }
  return i;
}

function startsRegex(tokens: Token[]): boolean {
  const previous = tokens[tokens.length - 1];
  if (previous === undefined) return true;
  if (previous.kind === 'punct') return previous.text !== ')' && previous.text !== ']' && previous.text !== '}';
  if (previous.kind === 'word') return REGEX_AFTER_WORDS.has(previous.text);
  return false;
}

/** End index (after flags) of a regex literal starting at `start`, or -1 when no closing `/` on that line. */
function regexEnd(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\n') return -1;
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      i++;
      while (i < source.length && isWordChar(source[i])) i++;
      return i;
    }
    i++;
  }
  return -1;
}
