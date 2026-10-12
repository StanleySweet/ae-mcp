import type { InstallerCheck } from '@ae-mcp/core';
import { buildChecklist, type ChecklistRow } from './checklist.js';

const STATUS_TEXT: Record<ChecklistRow['status'], string> = {
  ok: 'OK',
  fail: 'Fix',
  pending: '\u2014',
};

/** Renders the checklist rows into the given list element. */
export function renderChecklist(list: HTMLElement, rows: ChecklistRow[]): void {
  list.replaceChildren(
    ...rows.map((row) => {
      const item = document.createElement('li');
      item.className = `row row--${row.status}`;
      item.dataset.check = row.id;

      const label = document.createElement('span');
      label.className = 'row__label';
      label.textContent = row.label;

      const status = document.createElement('button');
      status.className = 'row__status';
      status.type = 'button';
      status.textContent = STATUS_TEXT[row.status];
      if (row.status !== 'fail') {
        status.disabled = true;
      }
      status.addEventListener('click', () => {
        if (row.status === 'fail') {
          window.dispatchEvent(new CustomEvent('installer:fix-row', { detail: { id: row.id } }));
        }
      });

      item.append(label, status);

      if (row.fix) {
        const fix = document.createElement('p');
        fix.className = 'row__fix';
        fix.textContent = row.fix;
        item.append(fix);
      }
      return item;
    }),
  );
}

async function main(): Promise<void> {
  const list = document.querySelector<HTMLElement>('#checklist');
  const installBtn = document.querySelector<HTMLButtonElement>('#install');
  const uninstallBtn = document.querySelector<HTMLButtonElement>('#uninstall');
  const progress = document.querySelector<HTMLElement>('#progress');
  const quitPrompt = document.querySelector<HTMLElement>('#quit-prompt');
  const retryBtn = document.querySelector<HTMLButtonElement>('#retry');
  const diagnosticsBtn = document.querySelector<HTMLButtonElement>('#diagnostics');
  if (!list) return;

  let environment = await window.installer.detect();
  renderChecklist(list, buildChecklist(environment));

  const refresh = async (checks: InstallerCheck[] = []): Promise<void> => {
    environment = await window.installer.detect();
    renderChecklist(list, buildChecklist(environment, checks));
    if (quitPrompt) {
      quitPrompt.hidden = !checks.some((check) => check.needsQuit === true);
    }
  };

  const runRepair = async (label: string): Promise<boolean> => {
    if (!progress) return false;
    progress.textContent = label;
    try {
      const result = await window.installer.repair();
      await refresh(result.checks);
      progress.textContent = result.ok ? 'Install complete' : 'Install finished with issues';
      return result.ok;
    } catch {
      progress.textContent = 'Install failed';
      return false;
    }
  };

  installBtn?.addEventListener('click', async () => {
    if (!installBtn) return;
    installBtn.disabled = true;
    if (uninstallBtn) uninstallBtn.disabled = true;
    await runRepair('Installing...');
    installBtn.disabled = false;
    if (uninstallBtn) uninstallBtn.disabled = false;
  });

  retryBtn?.addEventListener('click', () => {
    void runRepair('Retrying...');
  });

  diagnosticsBtn?.addEventListener('click', async () => {
    if (!progress) return;
    diagnosticsBtn.disabled = true;
    progress.textContent = 'Exporting diagnostics...';
    try {
      const path = await window.installer.diagnostics();
      progress.textContent = `Diagnostics saved to ${path}`;
    } catch {
      progress.textContent = 'Export failed';
    } finally {
      diagnosticsBtn.disabled = false;
    }
  });

  uninstallBtn?.addEventListener('click', async () => {
    if (!uninstallBtn || !progress) return;
    uninstallBtn.disabled = true;
    if (installBtn) installBtn.disabled = true;
    progress.textContent = 'Uninstalling...';
    try {
      await window.installer.uninstall();
      await refresh();
      progress.textContent = 'Uninstall complete';
    } catch {
      progress.textContent = 'Uninstall failed';
    } finally {
      uninstallBtn.disabled = false;
      if (installBtn) installBtn.disabled = false;
    }
  });

  window.addEventListener('installer:fix-row', () => {
    void runRepair('Repairing...');
  });
}

void main();
