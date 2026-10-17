import { defaultRunner, type Runner } from './osascript-transport.js';

export interface AeDialog {
  title: string;
  texts: string[];
}

export type DialogResult<T> = { ok: true; value: T } | { ok: false; message: string };

export const ACCESSIBILITY_FIX =
  'Grant Accessibility to your MCP client in System Settings > Privacy & Security > Accessibility, then retry.';

// Fields are tab-separated, one dialog per line: title, then each static text.
const FIND_DIALOGS = `
set found to {}
tell application "System Events"
  if not (exists process "After Effects") then return ""
  tell process "After Effects"
    repeat with w in windows
      try
        set sr to subrole of w
        if sr is "AXDialog" or sr is "AXSystemDialog" then
          set fields to {(name of w) as text}
          repeat with t in (static texts of w)
            try
              set end of fields to (value of t) as text
            end try
          end repeat
          set AppleScript's text item delimiters to tab
          set end of found to fields as text
        end if
      end try
    end repeat
  end tell
end tell
set AppleScript's text item delimiters to linefeed
return found as text
`;

// Only ever Cancel (or its French label) or Escape: never a button that saves.
const DISMISS_FRONT = `
tell application "System Events"
  if not (exists process "After Effects") then return "none"
  tell process "After Effects"
    repeat with w in windows
      try
        set sr to subrole of w
        if sr is "AXDialog" or sr is "AXSystemDialog" then
          repeat with label in {"Cancel", "Annuler"}
            if exists button label of w then
              click button label of w
              return "cancel"
            end if
          end repeat
          set frontmost to true
          key code 53
          return "escape"
        end if
      end try
    end repeat
    -- AE 26.5 hides its windows, dialogs included, from Accessibility, so none
    -- was found: press Escape blind, which closes a modal and is harmless without one.
    if (count of windows) is 0 then
      set frontmost to true
      delay 0.3
      key code 53
      return "escape-blind"
    end if
  end tell
end tell
return "none"
`;

function isPermissionError(error: unknown): boolean {
  const text = String((error as { stderr?: unknown })?.stderr ?? '') + String(error);
  return /-1719|-25211|assistive/i.test(text);
}

async function run(runner: Runner, script: string): Promise<DialogResult<string>> {
  try {
    const { stdout } = await runner('osascript', ['-e', script], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    return { ok: true, value: stdout.trim() };
  } catch (error) {
    return {
      ok: false,
      message: isPermissionError(error)
        ? `Cannot read After Effects windows: Accessibility permission is missing. ${ACCESSIBILITY_FIX}`
        : `Cannot read After Effects windows: ${String(error)}`,
    };
  }
}

export async function listDialogs(
  runner: Runner = defaultRunner,
): Promise<DialogResult<AeDialog[]>> {
  const out = await run(runner, FIND_DIALOGS);
  if (!out.ok) {
    return out;
  }
  const dialogs = out.value
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [title = '', ...texts] = line.split('\t');
      return { title, texts: texts.filter((t) => t.length > 0) };
    });
  return { ok: true, value: dialogs };
}

export type DismissMethod = 'cancel' | 'escape' | 'escape-blind' | 'none';

export async function dismissFrontDialog(
  runner: Runner = defaultRunner,
): Promise<DialogResult<DismissMethod>> {
  const out = await run(runner, DISMISS_FRONT);
  if (!out.ok) {
    return out;
  }
  const methods: DismissMethod[] = ['cancel', 'escape', 'escape-blind'];
  return { ok: true, value: methods.find((method) => method === out.value) ?? 'none' };
}

export function describeDialog(dialog: AeDialog): string {
  return [dialog.title, ...dialog.texts].filter((s) => s.length > 0).join(' - ');
}
