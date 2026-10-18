/** The bridge result shape the guard needs from project.info: a file and the dirty flag. */
export interface ProjectProbe {
  ok: boolean;
  result?: unknown;
}

/**
 * True when `project.new` with `force: true` would discard nothing, so the destructive guard's
 * increment save can be skipped (E16-6): the open project has a file on disk and no unsaved
 * changes. Any other case (dirty, never saved, or project.info unavailable) keeps the guard.
 */
export async function projectNewDiscardsNothing(
  op: string,
  args: Record<string, unknown>,
  probe: () => Promise<ProjectProbe>,
): Promise<boolean> {
  if (op !== 'project.new' || args.force !== true) {
    return false;
  }
  const info = await probe();
  if (!info.ok) {
    return false;
  }
  const project = info.result as { file?: unknown; dirty?: unknown } | null;
  return typeof project?.file === 'string' && project.dirty === false;
}
