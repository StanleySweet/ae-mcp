import { Buffer } from 'node:buffer';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createQueueConsumer,
  FakeProject,
  observeHandlers,
  type HandlerMap,
} from '@ae-mcp/fake-bridge';
import { errorSchema } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { createServer } from './server.js';

// A 1x1 transparent PNG, good enough to prove the bytes round-trip.
const FAKE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

type RenderHandler = (root: string) => HandlerMap;

async function connect(
  render: RenderHandler,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-render-frame-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const project = new FakeProject();
  project.addComp('Main', 1920, 1080, 25, { duration: 10 });
  const consumer = createQueueConsumer(root, { ...observeHandlers(project), ...render(root) }, 10);
  await consumer.start();
  const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ root, client: aeClient });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
      await consumer.stop();
    },
  };
}

/** Writes FAKE_PNG to the render directory and reports a direct-API render. */
function defaultRender(root: string): HandlerMap {
  const renderDir = join(root, 'render');
  return {
    'render.frame': async (args) => {
      const input = (args ?? {}) as { comp?: unknown; time?: unknown; file?: unknown };
      await mkdir(renderDir, { recursive: true });
      const file = typeof input.file === 'string' ? input.file : join(renderDir, 'Main-0.png');
      await writeFile(file, FAKE_PNG);
      return {
        method: 'direct',
        comp: 'Main',
        file,
        time: typeof input.time === 'number' ? input.time : 0,
        frame: 0,
        width: 1920,
        height: 1080,
      };
    },
  };
}

function imageContent(result: { content: unknown[] }): { type: string; data: string; mimeType: string } {
  return result.content.find(
    (item) => (item as { type?: string }).type === 'image',
  ) as { type: string; data: string; mimeType: string };
}

function textContent(result: { content: unknown[] }): Record<string, unknown> {
  const item = result.content.find((entry) => (entry as { type?: string }).type === 'text') as {
    text: string;
  };
  return JSON.parse(item.text) as Record<string, unknown>;
}

describe('ae_render_frame tool', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  async function start(render: RenderHandler = defaultRender): Promise<Client> {
    const { client, close } = await connect(render);
    closes.push(close);
    return client;
  }

  it('returns the rendered PNG as image content plus metadata', async () => {
    const client = await start();
    const result = (await client.callTool({
      name: 'ae_render_frame',
      arguments: { comp: 'Main', time: 1.5 },
    })) as { content: unknown[]; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const image = imageContent(result);
    expect(image.type).toBe('image');
    expect(image.mimeType).toBe('image/png');
    expect(image.data).toBe(FAKE_PNG.toString('base64'));

    const metadata = textContent(result);
    expect(metadata).toMatchObject({
      method: 'direct',
      comp: 'Main',
      frame: 0,
      width: 1920,
      height: 1080,
    });
    expect(typeof metadata.file).toBe('string');
  });

  it('defaults to the active comp when none is given', async () => {
    const client = await start();
    const result = (await client.callTool({ name: 'ae_render_frame', arguments: {} })) as {
      content: unknown[];
      isError?: boolean;
    };
    expect(result.isError).toBeFalsy();
    expect(imageContent(result).mimeType).toBe('image/png');
  });

  it('surfaces a bridge failure without image content', async () => {
    const client = await start(() => ({
      'render.frame': () => {
        throw new Error('no active composition');
      },
    }));
    const result = (await client.callTool({ name: 'ae_render_frame', arguments: {} })) as {
      content: unknown[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    const [first] = result.content as Array<{ type: string; text: string }>;
    expect(errorSchema.parse(JSON.parse(first!.text)).code).toBe('SCRIPT_ERROR');
  });

  it('refuses to read a file outside the render directory', async () => {
    const client = await start((root) => ({
      'render.frame': async () => {
        const secret = join(root, 'secret.png');
        await writeFile(secret, FAKE_PNG);
        return { method: 'direct', comp: 'Main', file: secret, time: 0, frame: 0 };
      },
    }));
    const result = (await client.callTool({ name: 'ae_render_frame', arguments: {} })) as {
      content: unknown[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    const [first] = result.content as Array<{ type: string; text: string }>;
    const error = errorSchema.parse(JSON.parse(first!.text));
    expect(error.code).toBe('SCRIPT_ERROR');
    expect(error.message).toContain('outside the render directory');
  });

  it('reports a missing rendered file', async () => {
    const client = await start((root) => ({
      'render.frame': () => ({
        method: 'queue',
        comp: 'Main',
        file: join(root, 'render', 'gone.png'),
        time: 0,
        frame: 0,
      }),
    }));
    const result = (await client.callTool({ name: 'ae_render_frame', arguments: {} })) as {
      content: unknown[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    const [first] = result.content as Array<{ type: string; text: string }>;
    const error = errorSchema.parse(JSON.parse(first!.text));
    expect(error.code).toBe('SCRIPT_ERROR');
    expect(error.message).toContain('could not read rendered frame');
  });
});
