import { readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  PROTOCOL_VERSION,
  inboxDir,
  outboxDir,
  ensureQueue,
  writeAtomic,
  jobSchema,
  resultSchema,
  makeError,
  type ResultMessage,
} from '@ae-mcp/protocol';

export type ToolHandler = (args: unknown) => unknown | Promise<unknown>;
export type HandlerMap = Record<string, ToolHandler>;

export interface QueueConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

function timedOut(id: string): ResultMessage {
  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    error: makeError('TIMEOUT', `job ${id} exceeded its deadline`),
  };
}

function unknownTool(tool: string): ResultMessage {
  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    error: makeError('UNKNOWN_TOOL', `no handler for tool '${tool}'`),
  };
}

function invalidMessage(name: string): ResultMessage {
  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    error: makeError('INVALID_MESSAGE', `job ${name} is not a valid message`),
  };
}

export function createQueueConsumer(
  root: string,
  handlers: HandlerMap,
  pollMs = 100,
): QueueConsumer {
  let running = false;
  let stopped = Promise.resolve();

  const processFile = async (name: string): Promise<void> => {
    const inbox = inboxDir(root);
    const id = name.endsWith('.json') ? name.slice(0, -5) : name;
    let result: ResultMessage;
    try {
      const raw = await readFile(join(inbox, name), 'utf8');
      const job = jobSchema.parse(JSON.parse(raw));
      if (Date.now() > job.deadline) {
        result = timedOut(id);
      } else {
        const handler = handlers[job.tool];
        if (handler === undefined) {
          result = unknownTool(job.tool);
        } else {
          try {
            result = {
              protocolVersion: PROTOCOL_VERSION,
              ok: true,
              result: await handler(job.args),
            };
          } catch (error) {
            result = {
              protocolVersion: PROTOCOL_VERSION,
              ok: false,
              error: makeError(
                'SCRIPT_ERROR',
                error instanceof Error ? error.message : String(error),
              ),
            };
          }
        }
      }
    } catch {
      result = invalidMessage(name);
    }
    const written = resultSchema.parse(result);
    await writeAtomic(join(outboxDir(root), name), JSON.stringify(written));
    await unlink(join(inbox, name));
  };

  const loop = async (): Promise<void> => {
    while (running) {
      await ensureQueue(root);
      for (const name of await readdir(inboxDir(root))) {
        if (!running || !name.endsWith('.json')) {
          continue;
        }
        await processFile(name);
      }
      await delay(pollMs);
    }
  };

  return {
    start(): Promise<void> {
      running = true;
      stopped = loop();
      return Promise.resolve();
    },
    stop(): Promise<void> {
      running = false;
      return stopped;
    },
  };
}