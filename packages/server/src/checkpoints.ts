import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic } from '@ae-mcp/protocol';

/** A named restore point: the versioned project file an incremental save produced. */
export interface Checkpoint {
  name: string;
  file: string;
  createdAt: string;
}

const NAME_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;

export function isValidCheckpointName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

export function checkpointsPath(root: string): string {
  return join(root, 'checkpoints.json');
}

function isCheckpoint(value: unknown): value is Checkpoint {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return typeof entry.name === 'string' && typeof entry.file === 'string' && typeof entry.createdAt === 'string';
}

/** Every stored checkpoint in creation order (oldest first). Missing file: empty list. */
export async function readCheckpoints(root: string): Promise<Checkpoint[]> {
  let text: string;
  try {
    text = await readFile(checkpointsPath(root), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  // A corrupt file is an error, not an empty list: saving over it would lose the restore points.
  const parsed = JSON.parse(text) as { checkpoints?: unknown };
  if (!Array.isArray(parsed.checkpoints) || !parsed.checkpoints.every(isCheckpoint)) {
    throw new Error(`checkpoints file is malformed: ${checkpointsPath(root)}`);
  }
  return parsed.checkpoints;
}

/**
 * Records a checkpoint. A name that already exists is replaced and moves to the
 * newest position. Returns the stored list in creation order.
 */
export async function saveCheckpoint(root: string, checkpoint: Checkpoint): Promise<Checkpoint[]> {
  const existing = await readCheckpoints(root);
  const next = [...existing.filter((entry) => entry.name !== checkpoint.name), checkpoint];
  await writeAtomic(checkpointsPath(root), JSON.stringify({ checkpoints: next }, null, 2));
  return next;
}
