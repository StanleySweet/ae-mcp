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

      const statusEl = document.createElement('button');
      statusEl.className = 'row__status';
      statusEl.textContent = STATUS_TEXT[row.status];
      statusEl.type = 'button';
      if (row.status !== 'fail') {
        statusEl.disabled = true;
      }
      statusEl.addEventListener('click', () => {
        if (row.status === 'fail') {
          window.dispatchEvent(new CustomEvent('installer:fix-row', { detail: { id: row.id } }));
        }
      });

      item.append(label, statusEl);

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
  if (!list) return;

  let environment = await window.installer.detect();
  let rows = buildChecklist(environment);
  renderChecklist(list, rows);

  installBtn?.addEventListener('click', async () => {
    if (!installBtn || !progress) return;
    installBtn.disabled = true;
    uninstallBtn?.setAttribute('disabled', 'true');
    progress.textContent = 'Installing...';
    try {
      const result = await window.installer.repair();
      environment = await window.installer.detect();
      rows = buildChecklist(environment, result.checks);
      renderChecklist(list, rows);
      progress.textContent = result.ok ? 'Install complete' : 'Install finished with issues';
    } catch (error) {
      progress.textContent = 'Install failed';
    } finally {
      installBtn.disabled = false;
      uninstallBtn?.removeAttribute('disabled');
    }
  });

  uninstallBtn?.addEventListener('click', async () => {
    if (!uninstallBtn || !progress) return;
    uninstallBtn.disabled = true;
    installBtn?.setAttribute('disabled', 'true');
    progress.textContent = 'Uninstalling...';
    try {
      await window.installer.uninstall();
      environment = await window.installer.detect();
      rows = buildChecklist(environment, []);
      renderChecklist(list, rows);
      progress.textContent = 'Uninstall complete';
    } catch (error) {
      progress.textContent = 'Uninstall failed';
    } finally {
      uninstallBtn.disabled = false;
      installBtn?.removeAttribute('disabled');
    }
  });

  window.addEventListener('installer:fix-row', async (event) => {
    if (!progress) return;
    const id = (event as CustomEvent<{ id: string }>).detail?.id;
    progress.textContent = `Repairing ${id}...`;
    try {
      const result = await window.installer.repair();
      environment = await window.installer.detect();
      rows = buildChecklist(environment, result.checks);
      renderChecklist(list, rows);
      progress.textContent = 'Repair complete';
    } catch (error) {
      progress.textContent = 'Repair failed';
    }
  });
}

void main();
