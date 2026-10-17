import { Buffer } from 'node:buffer';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer, FakeProject, observeHandlers, type HandlerMap } from '@ae-mcp/fake-bridge';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { pngSize } from './frame-image.js';
import { createServer, type ServerOptions } from './server.js';

// The PNG end marker every complete file carries (see waitForCompletePng).
const PNG_END = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

/** A PNG that is just a signature, an IHDR with the given size and the end marker. */
function sizedPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, PNG_END]);
}

/** A 24-bit BMP filled with one colour, the stand-in for `sips -s format bmp`. */
function solidBmp(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const stride = Math.floor((width * 24 + 31) / 32) * 4;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = y * stride + x * 3;
      data[o] = b;
      data[o + 1] = g;
      data[o + 2] = r;
    }
  }
  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(54 + data.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(data.length, 34);
  return Buffer.concat([header, data]);
}

async function connect(
  handlers: (root: string) => HandlerMap,
  serverOptions: Partial<ServerOptions> = {},
): Promise<{ client: Client; close: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-render-image-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const project = new FakeProject();
  project.addComp('Main', 64, 48, 25, { duration: 10 });
  const consumer = createQueueConsumer(root, { ...observeHandlers(project), ...handlers(root) }, 10);
  await consumer.start();
  const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({
    root,
    client: aeClient,
    frameWait: { timeoutMs: 1000, intervalMs: 10 },
    ...serverOptions,
  });
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

/** Renders a frame of the given size for each requested time, writing it under the render folder. */
function sizedRender(
  width: number,
  height: number,
  onRender?: (time: number) => void,
): (root: string) => HandlerMap {
  return (root) => ({
    'render.frame': async (args) => {
      const input = (args ?? {}) as { time?: unknown };
      const time = typeof input.time === 'number' ? input.time : 0;
      onRender?.(time);
      const renderDir = join(root, 'render');
      await mkdir(renderDir, { recursive: true });
      const file = join(renderDir, `Main-${Math.round(time * 25)}.png`);
      await writeFile(file, sizedPng(width, height));
      return { method: 'direct', comp: 'Main', file, time, frame: Math.round(time * 25), width, height };
    },
  });
}

function imageOf(result: { content: unknown[] }): Buffer {
  const image = result.content.find((item) => (item as { type?: string }).type === 'image') as { data: string };
  return Buffer.from(image.data, 'base64');
}

function metadataOf(result: { content: unknown[] }): Record<string, unknown> {
  const item = result.content.find((entry) => (entry as { type?: string }).type === 'text') as { text: string };
  return JSON.parse(item.text) as Record<string, unknown>;
}

describe('ae_render_frame image sizing (#253, #234)', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  async function start(
    handlers: (root: string) => HandlerMap,
    options: Partial<ServerOptions> = {},
  ): Promise<Client> {
    const { client, close } = await connect(handlers, options);
    closes.push(close);
    return client;
  }

  it('crops a region of the frame with the pixels of that rectangle', async () => {
    const client = await start(sizedRender(64, 48), {
      toBmp: async (_png, bmp) => {
        await writeFile(bmp, solidBmp(64, 48, [200, 10, 10]));
      },
    });

    const result = (await client.callTool({
      name: 'ae_render_frame',
      arguments: { region: [8, 4, 16, 8] },
    })) as { content: unknown[]; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(pngSize(imageOf(result))).toEqual({ width: 16, height: 8 });
    expect(metadataOf(result).region).toEqual([8, 4, 16, 8]);
  });

  it('refuses a region that lies outside the frame', async () => {
    const client = await start(sizedRender(64, 48), {
      toBmp: async (_png, bmp) => {
        await writeFile(bmp, solidBmp(64, 48, [0, 0, 0]));
      },
    });

    const result = (await client.callTool({
      name: 'ae_render_frame',
      arguments: { region: [60, 0, 10, 10] },
    })) as { content: unknown[]; isError?: boolean };

    expect(result.isError).toBe(true);
    const [first] = result.content as Array<{ text: string }>;
    expect(JSON.parse(first!.text)).toMatchObject({ code: 'INVALID_ARGS' });
  });

  it('builds one contact sheet of several frames, one grid cell each', async () => {
    const rendered: number[] = [];
    const client = await start(
      sizedRender(64, 48, (time) => rendered.push(time)),
      {
        toBmp: async (_png, bmp) => {
          await writeFile(bmp, solidBmp(64, 48, [30, 90, 200]));
        },
      },
    );

    const result = (await client.callTool({
      name: 'ae_render_frame',
      arguments: { times: [0, 0.5, 1, 1.5], maxEdge: 100 },
    })) as { content: unknown[]; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(rendered).toEqual([0, 0.5, 1, 1.5]);
    // Two columns of 50 px cells, 4:3 frames: 50 x 38 per cell, two rows.
    expect(pngSize(imageOf(result))).toEqual({ width: 100, height: 76 });
    const cells = metadataOf(result).cells as Array<{ time: number }>;
    expect(cells.map((cell) => cell.time)).toEqual([0, 0.5, 1, 1.5]);
    expect(metadataOf(result).file).toBeNull();
  });

  it('refuses times together with time, and times together with compareWith', async () => {
    const client = await start(sizedRender(64, 48));

    const both = (await client.callTool({
      name: 'ae_render_frame',
      arguments: { time: 1, times: [0, 1] },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(both.isError).toBe(true);
    expect(JSON.parse(both.content[0]!.text)).toMatchObject({ code: 'INVALID_ARGS' });

    const compare = (await client.callTool({
      name: 'ae_render_frame',
      arguments: { times: [0, 1], compareWith: 'x.png' },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(compare.isError).toBe(true);
    expect(JSON.parse(compare.content[0]!.text)).toMatchObject({ code: 'INVALID_ARGS' });
  });
});

describe('ae_render_frame atKeys (E15-5)', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  // Keyframes of the stub layer, returned by keyframe.times; every call is recorded.
  function keyed(keys: number[], rendered: number[], asked: unknown[]): (root: string) => HandlerMap {
    return (root) => ({
      ...sizedRender(64, 48, (time) => rendered.push(time))(root),
      'keyframe.times': async (args) => {
        asked.push(args);
        return { comp: 'Main', layers: 1, times: keys };
      },
    });
  }

  it('renders a sheet at the keys and their midpoints, reading the layer given', async () => {
    const rendered: number[] = [];
    const asked: unknown[] = [];
    const { client, close } = await connect(keyed([0, 1], rendered, asked), {
      toBmp: async (_png, bmp) => {
        await writeFile(bmp, solidBmp(64, 48, [30, 90, 200]));
      },
    });
    closes.push(close);

    const result = (await client.callTool({
      name: 'ae_render_frame',
      arguments: { atKeys: true, index: 1 },
    })) as { content: unknown[]; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(asked[0]).toMatchObject({ index: 1 });
    expect(rendered).toEqual([0, 0.5, 1]);
    expect(pngSize(imageOf(result))).not.toBeNull();
  });

  it('refuses atKeys together with times', async () => {
    const rendered: number[] = [];
    const asked: unknown[] = [];
    const { client, close } = await connect(keyed([0, 1], rendered, asked));
    closes.push(close);

    const result = (await client.callTool({
      name: 'ae_render_frame',
      arguments: { atKeys: true, times: [0] },
    })) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ code: 'INVALID_ARGS' });
    expect(asked).toHaveLength(0);
  });

  it('says so when the layer has no keyframes', async () => {
    const rendered: number[] = [];
    const asked: unknown[] = [];
    const { client, close } = await connect(keyed([], rendered, asked));
    closes.push(close);

    const result = (await client.callTool({
      name: 'ae_render_frame',
      arguments: { atKeys: true, index: 2 },
    })) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ code: 'INVALID_ARGS' });
    expect(rendered).toHaveLength(0);
  });
});
