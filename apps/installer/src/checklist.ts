import type { DetectedEnvironment, InstallerCheck } from '@ae-mcp/core';

export type ChecklistStatus = 'ok' | 'fail' | 'pending';

export interface ChecklistRow {
  id: string;
  label: string;
  status: ChecklistStatus;
  fix?: string;
}

/** The six rows the Setup window shows, in order. */
export const CHECKLIST_ITEMS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'after_effects', label: 'After Effects found' },
  { id: 'claude', label: 'Claude Desktop found' },
  { id: 'bridge_payload', label: 'Bridge installed' },
  { id: 'scripting_pref', label: 'Scripting permission' },
  { id: 'claude_extension', label: 'Claude extension' },
  { id: 'live_test', label: 'Test' },
];

interface RowState {
  status: ChecklistStatus;
  fix?: string;
}

function environmentState(id: string, environment: DetectedEnvironment): RowState | undefined {
  if (id === 'after_effects') {
    return environment.afterEffects.length > 0
      ? { status: 'ok' }
      : { status: 'fail', fix: 'Install After Effects, then reopen Setup.' };
  }
  if (id === 'claude') {
    return environment.claudeDesktop === null
      ? { status: 'fail', fix: 'Install Claude Desktop, then reopen Setup.' }
      : { status: 'ok' };
  }
  return undefined;
}

function checkState(checks: InstallerCheck[], id: string): RowState | undefined {
  const check = checks.find((entry) => entry.check === id);
  return check ? { status: check.status, fix: check.fix } : undefined;
}

/**
 * Builds the checklist rows shown in the Setup window from the detected
 * environment plus any install/repair results. Rows with no result yet are
 * `pending`.
 */
export function buildChecklist(
  environment: DetectedEnvironment,
  checks: InstallerCheck[] = [],
): ChecklistRow[] {
  return CHECKLIST_ITEMS.map(({ id, label }) => {
    const state: RowState =
      environmentState(id, environment) ?? checkState(checks, id) ?? { status: 'pending' };
    return { id, label, status: state.status, fix: state.fix };
  });
}
