import type { HistoryEntry } from './history.js';
import type { OperationRegistry } from './operations.js';

/**
 * Operations batch.run refuses (AEMCP_NOT_IN_BATCH in job-runner.js): the save and
 * open ops leave nothing in AE's undo history, so they cannot be replayed in a batch.
 */
export const NOT_REPLAYABLE = ['project.undo', 'project.save', 'project.open', 'project.new', 'project.increment_save'];

export interface ReplayStep {
  op: string;
  args: Record<string, unknown>;
}

export interface SkippedStep {
  seq: number;
  op: string;
  reason: string;
}

export interface ReplayPlan {
  ops: ReplayStep[];
  skipped: SkippedStep[];
}

/**
 * Turns recorded history into the steps of one batch. Only steps that succeeded and
 * changed the project are kept; a batch.run entry contributes its mutating sub-ops.
 * With `comp`, every step that names a comp argument is retargeted to it. Steps that
 * name no comp keep working on whatever comp is active when the replay runs.
 */
export function replaySteps(
  entries: HistoryEntry[],
  operations: OperationRegistry,
  comp?: string,
): ReplayPlan {
  const ops: ReplayStep[] = [];
  const skipped: SkippedStep[] = [];
  const add = (seq: number, op: string, args: Record<string, unknown>): void => {
    const definition = operations.get(op);
    if (definition === undefined) {
      skipped.push({ seq, op, reason: 'unknown operation' });
      return;
    }
    if (definition.readOnly) {
      return;
    }
    if (NOT_REPLAYABLE.includes(op)) {
      skipped.push({ seq, op, reason: 'cannot run inside batch.run' });
      return;
    }
    const copy: Record<string, unknown> = { ...args };
    if (comp !== undefined && copy.comp !== undefined) {
      copy.comp = comp;
    }
    ops.push({ op, args: copy });
  };

  for (const entry of entries) {
    if (!entry.ok) {
      skipped.push({ seq: entry.seq, op: entry.op, reason: 'the call failed' });
      continue;
    }
    if (entry.op !== 'batch.run') {
      add(entry.seq, entry.op, entry.args);
      continue;
    }
    const subs = Array.isArray(entry.args.ops) ? (entry.args.ops as Array<Record<string, unknown>>) : [];
    for (const sub of subs) {
      const subOp = typeof sub.op === 'string' ? sub.op : '';
      if (subOp === 'batch.run') {
        skipped.push({ seq: entry.seq, op: subOp, reason: 'nested batch.run' });
        continue;
      }
      const subArgs = (sub.args ?? {}) as Record<string, unknown>;
      add(entry.seq, subOp, subArgs);
    }
  }
  return { ops, skipped };
}

/** The args object `batch.run` takes: runs unchanged through `ae_do {op: 'batch.run', args}`. */
export function batchJson(plan: ReplayPlan): string {
  return `${JSON.stringify({ ops: plan.ops }, null, 2)}\n`;
}

/**
 * A standalone ExtendScript file: the installed bridge payload, then a footer that
 * runs the steps as one batch. It needs no server. Set AEMCP_REPLAY_COMP at the top
 * of the footer to retarget the steps at run time (null keeps the export target).
 */
export function replayJsx(plan: ReplayPlan, payload: string, comp: string | null, exportedAt: string): string {
  const batch = JSON.stringify(JSON.stringify({ ops: plan.ops }));
  const footer = [
    '',
    `// ---- ae-mcp replay: exported ${exportedAt}, ${plan.ops.length} step(s). ----`,
    '// Set AEMCP_REPLAY_COMP to a comp name to run the steps against that comp instead.',
    `var AEMCP_REPLAY_COMP = ${JSON.stringify(comp)};`,
    `var AEMCP_REPLAY_OPS = JSON.parse(${batch});`,
    '(function () {',
    '    var ops = AEMCP_REPLAY_OPS.ops;',
    '    var i;',
    '    if (AEMCP_REPLAY_COMP !== null) {',
    '        for (i = 0; i < ops.length; i++) {',
    '            if (ops[i].args && ops[i].args.comp !== undefined) {',
    '                ops[i].args.comp = AEMCP_REPLAY_COMP;',
    '            }',
    '        }',
    '    }',
    "    var outcome = AEMCP.invoke('batch.run', { ops: ops }, null);",
    '    writeLn(JSON.stringify(outcome));',
    '})();',
    '',
  ].join('\n');
  return `${payload}${footer}`;
}
