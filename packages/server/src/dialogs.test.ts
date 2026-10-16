import { describe, it, expect } from 'vitest';
import { dismissFrontDialog, listDialogs } from './dialogs.js';
import type { Runner } from './osascript-transport.js';

function runnerReturning(stdout: string, scripts: string[] = []): Runner {
  return async (_command, args) => {
    scripts.push(args.join('\n'));
    return { stdout };
  };
}

function runnerFailing(message: string, stderr = ''): Runner {
  return async () => {
    throw Object.assign(new Error(message), { stderr });
  };
}

describe('listDialogs', () => {
  it('parses one dialog per line with its static texts', async () => {
    const out = 'Warning\tSave changes before closing?\tYour changes will be lost.\nAlert\t\n';
    const result = await listDialogs(runnerReturning(out));
    expect(result).toEqual({
      ok: true,
      value: [
        { title: 'Warning', texts: ['Save changes before closing?', 'Your changes will be lost.'] },
        { title: 'Alert', texts: [] },
      ],
    });
  });

  it('returns an empty list when no dialog is open', async () => {
    expect(await listDialogs(runnerReturning('\n'))).toEqual({ ok: true, value: [] });
  });

  it('explains how to grant Accessibility when it is missing', async () => {
    const result = await listDialogs(
      runnerFailing(
        'Command failed',
        'execution error: osascript is not allowed assistive access. (-1719)',
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('System Settings > Privacy & Security > Accessibility');
    }
  });

  it('reports other failures without the permission advice', async () => {
    const result = await listDialogs(runnerFailing('spawn osascript ENOENT'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('ENOENT');
      expect(result.message).not.toContain('Accessibility');
    }
  });
});

describe('dismissFrontDialog', () => {
  it('reports how the dialog was closed', async () => {
    expect(await dismissFrontDialog(runnerReturning('cancel\n'))).toEqual({
      ok: true,
      value: 'cancel',
    });
    expect(await dismissFrontDialog(runnerReturning('escape'))).toEqual({
      ok: true,
      value: 'escape',
    });
    expect(await dismissFrontDialog(runnerReturning('none'))).toEqual({ ok: true, value: 'none' });
  });

  it('only ever presses Cancel/Annuler or Escape, never a save button', async () => {
    const scripts: string[] = [];
    await dismissFrontDialog(runnerReturning('cancel', scripts));
    const script = scripts.join('\n');
    expect(script).toContain('"Cancel"');
    expect(script).toContain('"Annuler"');
    expect(script).toContain('key code 53');
    expect(script).not.toMatch(/save|enregistrer/i);
  });

  it('surfaces the Accessibility fix on a permission error', async () => {
    const result = await dismissFrontDialog(runnerFailing('osascript: (-25211)'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('Accessibility');
    }
  });
});
