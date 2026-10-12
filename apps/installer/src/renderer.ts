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

      const status = document.createElement('span');
      status.className = 'row__status';
      status.textContent = STATUS_TEXT[row.status];

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
  if (!list) return;
  const environment = await window.installer.detect();
  renderChecklist(list, buildChecklist(environment));
}

void main();
