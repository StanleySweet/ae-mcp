/** Longest string a report returns in full. Longer strings are cut to this many characters (#256). */
export const MAX_REPORT_STRING_CHARS = 2000;

/**
 * Cuts every string property longer than `maxChars` in a report value (recursively, through
 * objects and arrays). A cut string `key` gets two siblings: `keyTruncated: true` and
 * `keyLength` with the full length. Strings under the limit are returned unchanged.
 */
export function truncateLongStrings<T>(value: T, maxChars: number = MAX_REPORT_STRING_CHARS): T {
  if (Array.isArray(value)) {
    return value.map((item) => truncateLongStrings(item, maxChars)) as T;
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && child.length > maxChars) {
      out[key] = child.slice(0, maxChars);
      out[`${key}Truncated`] = true;
      out[`${key}Length`] = child.length;
    } else {
      out[key] = truncateLongStrings(child, maxChars);
    }
  }
  return out as T;
}
