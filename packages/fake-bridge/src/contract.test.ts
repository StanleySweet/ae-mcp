import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  contractCases,
  inboxDir,
  outboxDir,
  writeAtomic,
  type BridgeDriver,
  type ResultMessage,
} from '@ae-mcp/protocol';
import { beforeEach, afterEach, describe, it } from 'vitest';
import { createQueueConsumer } from './consumer.js';

async function waitForResult(root: string, id: string): Promise<ResultMessage> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(join(outboxDir(root), `${id}.json`), 'utf8'));
    } catch {
      await delay(25);
    }
  }
  throw new Error(`timed out waiting for result ${id}`);
}

describe('contract: fake-bridge', () => {
  let root: string;
  let consumer: ReturnType<typeof createQueueConsumer>;
  let driver: BridgeDriver;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ae-mcp-contract-'));
    consumer = createQueueConsumer(root, { 'fake.echo': (args) => args }, 10);
    await consumer.start();
    driver = {
      sendJob: async (job) => {
        await writeAtomic(join(inboxDir(root), `${job.id}.json`), JSON.stringify(job));
      },
      sendRaw: async (name, content) => {
        await writeAtomic(join(inboxDir(root), name), content);
      },
      waitForResult: async (id) => waitForResult(root, id),
    };
  });

  afterEach(async () => {
    await consumer.stop();
    await rm(root, { recursive: true, force: true });
  });

  for (const contract of contractCases('fake.echo')) {
    it(contract.name, () => contract.run(driver));
  }
});