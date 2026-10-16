import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { packBundle } from './pack.js';
import { createQueueConsumer, FakeProject, observeHandlers } from '@ae-mcp/fake-bridge';

export interface SmokeResult {
  toolNames: string[];
  /** Server instructions received on initialize, when the server provides them. */
  instructions?: string;
}

/** Packs the bundle, unpacks it, then starts the packaged server against the fake
bridge and returns the tools it lists plus its initialize instructions. */
export async function runSmoke(): Promise<SmokeResult> {
  const base = await mkdtemp(join(tmpdir(), 'ae-mcp-smoke-'));
  const aeRoot = join(base, 'ae-mcp');
  const consumer = createQueueConsumer(aeRoot, observeHandlers(new FakeProject()));
  await consumer.start();

  let client: Client | undefined;
  try {
    const artifact = await packBundle(join(base, 'out'));
    const extract = join(base, 'extract');
    execFileSync('unzip', ['-o', '-q', artifact, '-d', extract]);

    client = new Client({ name: 'bundle-smoke', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(extract, 'server', 'index.js')],
        env: { ...getDefaultEnvironment(), AE_MCP_ROOT: aeRoot },
      }),
    );
    const { tools } = await client.listTools();
    return { toolNames: tools.map((tool) => tool.name), instructions: client.getInstructions() };
  } finally {
    await client?.close();
    await consumer.stop();
    await rm(base, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const { toolNames } = await runSmoke();
  process.stdout.write(`bundle smoke ok: ${toolNames.length} tools\n`);
}
