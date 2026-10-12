/** A structured event parsed from one line of aerender output. */
export type AerenderEvent =
  | { type: 'version'; version: string }
  | { type: 'launching' }
  | { type: 'progress'; frame: number; rendered: number; seconds: number }
  | { type: 'error'; message: string };

const VERSION_RE = /^aerender version (.+)$/;
const LAUNCHING = 'PROGRESS: Launching After Effects...';
// aerender prints per-frame progress as `PROGRESS: 00015 (16): 0 Seconds`.
// Ref: https://helpx.adobe.com/after-effects/desktop/render-and-export/automate-rendering/automated-rendering-network-rendering.html
const PROGRESS_RE = /^PROGRESS:\s+(\d+)\s+\((\d+)\):\s+(\d+)\s+Seconds/;
const ERROR_RE = /^aerender ERROR\b/;

/**
 * Parses one line of aerender stdout/stderr into an event, or null when the
 * line carries nothing actionable (most setting lines aerender prints).
 */
export function parseAerenderLine(line: string): AerenderEvent | null {
  const trimmed = line.trim();
  if (trimmed === '') {
    return null;
  }
  if (trimmed === LAUNCHING) {
    return { type: 'launching' };
  }
  const version = VERSION_RE.exec(trimmed);
  if (version !== null) {
    return { type: 'version', version: version[1]!.trim() };
  }
  const progress = PROGRESS_RE.exec(trimmed);
  if (progress !== null) {
    return {
      type: 'progress',
      frame: Number(progress[1]),
      rendered: Number(progress[2]),
      seconds: Number(progress[3]),
    };
  }
  if (ERROR_RE.test(trimmed)) {
    return { type: 'error', message: trimmed };
  }
  return null;
}
