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
import type { FrameComparison } from './frame-compare.js';
import { createServer, readRenderedFrame } from './server.js';

// A 1x1 transparent PNG, good enough to prove the bytes round-trip.
const FAKE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
// The 12-byte IEND chunk every complete PNG ends with; readRenderedFrame waits for it.
const PNG_END = FAKE_PNG.subarray(FAKE_PNG.length - 12);
const bigFrame = (size: number): Buffer => Buffer.concat([Buffer.alloc(size, 1), PNG_END]);

type RenderHandler = (root: string) => HandlerMap;

async function connect(
  render: RenderHandler,
  serverOptions: {
    frameCompare?: (before: string, after: string) => Promise<FrameComparison>;
    resizeFrame?: (file: string, maxEdge: number) => Promise<string | null>;
  } = {},
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

  async function start(
    render: RenderHandler = defaultRender,
    serverOptions?: Parameters<typeof connect>[1],
  ): Promise<Client> {
    const { client, close } = await connect(render, serverOptions);
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
    expect(error.message).toContain('not finished writing');
  });

  it('accepts a maxEdge argument', async () => {
    const client = await start();
    const result = (await client.callTool({
      name: 'ae_render_frame',
      arguments: { maxEdge: 800 },
    })) as { content: unknown[]; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(imageContent(result).mimeType).toBe('image/png');
  });

  describe('image size (#253)', () => {
    /** A PNG whose IHDR says width x height, followed by the end marker. */
    const pngWithSize = (width: number, height: number): Buffer => {
      const ihdr = Buffer.alloc(25);
      ihdr.writeUInt32BE(13, 0);
      ihdr.write('IHDR', 4, 'ascii');
      ihdr.writeUInt32BE(width, 8);
      ihdr.writeUInt32BE(height, 12);
      return Buffer.concat([FAKE_PNG.subarray(0, 8), ihdr, PNG_END]);
    };
    const sizedRender =
      (width: number, height: number): RenderHandler =>
      (root) => ({
        'render.frame': async () => {
          await mkdir(join(root, 'render'), { recursive: true });
          const file = join(root, 'render', 'Main-0.png');
          await writeFile(file, pngWithSize(width, height));
          return { method: 'direct', comp: 'Main', file, time: 0, frame: 0, width, height };
        },
      });
    const imageSize = (result: { content: unknown[] }): { width: number; height: number } => {
      const data = Buffer.from(imageContent(result).data, 'base64');
      return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    };
    const shrinkTo = (requested: number[]) => async (file: string, maxEdge: number) => {
      requested.push(maxEdge);
      const smaller = file.replace(/\.png$/, `-${maxEdge}.png`);
      await writeFile(smaller, pngWithSize(Math.min(maxEdge, 1920), Math.round((Math.min(maxEdge, 1920) * 1080) / 1920)));
      return smaller;
    };

    it('scales a larger frame to a longest edge of 768 by default', async () => {
      const requested: number[] = [];
      const client = await start(sizedRender(1920, 1080), { resizeFrame: shrinkTo(requested) });
      const result = (await client.callTool({ name: 'ae_render_frame', arguments: {} })) as { content: unknown[] };

      expect(requested).toEqual([768]);
      expect(imageSize(result)).toEqual({ width: 768, height: 432 });
    });

    it('scales to a larger maxEdge when the caller asks for one', async () => {
      const requested: number[] = [];
      const client = await start(sizedRender(1920, 1080), { resizeFrame: shrinkTo(requested) });
      const result = (await client.callTool({ name: 'ae_render_frame', arguments: { maxEdge: 1200 } })) as {
        content: unknown[];
      };

      expect(requested).toEqual([1200]);
      expect(imageSize(result)).toEqual({ width: 1200, height: 675 });
    });

    it('leaves a frame within maxEdge untouched', async () => {
      const requested: number[] = [];
      const client = await start(sizedRender(640, 360), { resizeFrame: shrinkTo(requested) });
      const result = (await client.callTool({ name: 'ae_render_frame', arguments: {} })) as { content: unknown[] };

      expect(requested).toEqual([]);
      expect(imageSize(result)).toEqual({ width: 640, height: 360 });
    });
  });

  describe('compareWith', () => {
    const comparison: FrameComparison = { changedPercent: 12.5, meanDelta: 3.2, bbox: [4, 5, 6, 7] };

    /** Renders once (so a frame exists in the render folder) and returns the client and root. */
    async function startWithFrame(
      serverOptions: Parameters<typeof connect>[1],
    ): Promise<{ client: Client; root: string; first: string }> {
      let root = '';
      const client = await start((r) => {
        root = r;
        return defaultRender(r);
      }, serverOptions);
      const rendered = (await client.callTool({ name: 'ae_render_frame', arguments: {} })) as {
        content: unknown[];
      };
      return { client, root, first: textContent(rendered).file as string };
    }

    async function callWith(client: Client, compareWith: string): Promise<{ content: unknown[]; isError?: boolean }> {
      return (await client.callTool({
        name: 'ae_render_frame',
        arguments: { compareWith },
      })) as { content: unknown[]; isError?: boolean };
    }

    const mustNotCompare = async (): Promise<FrameComparison> => {
      throw new Error('must not compare');
    };

    it('adds the comparison of the new frame against the previous one to the metadata', async () => {
      const calls: Array<[string, string]> = [];
      const { client, first } = await startWithFrame({
        frameCompare: async (before, after) => {
          calls.push([before, after]);
          return comparison;
        },
      });
      const result = await callWith(client, first);

      expect(result.isError).toBeFalsy();
      expect(textContent(result).compare).toEqual(comparison);
      expect(calls).toEqual([[first, first]]);
      expect(imageContent(result).mimeType).toBe('image/png');
    });

    it('omits compare when compareWith is not given', async () => {
      const client = await start(defaultRender, { frameCompare: mustNotCompare });
      const result = (await client.callTool({ name: 'ae_render_frame', arguments: {} })) as {
        content: unknown[];
      };
      expect(textContent(result)).not.toHaveProperty('compare');
    });

    it('refuses a compareWith path outside the render directory', async () => {
      const { client, root } = await startWithFrame({ frameCompare: mustNotCompare });
      const result = await callWith(client, join(root, 'secret.png'));
      expect(result.isError).toBe(true);
      const [first] = result.content as Array<{ type: string; text: string }>;
      const error = errorSchema.parse(JSON.parse(first!.text));
      expect(error.code).toBe('INVALID_ARGS');
      expect(error.message).toContain('render directory');
    });

    it('refuses a compareWith frame that does not exist', async () => {
      const { client, root } = await startWithFrame({ frameCompare: mustNotCompare });
      const result = await callWith(client, join(root, 'render', 'missing.png'));
      expect(result.isError).toBe(true);
      const [first] = result.content as Array<{ type: string; text: string }>;
      const error = errorSchema.parse(JSON.parse(first!.text));
      expect(error.code).toBe('INVALID_ARGS');
      expect(error.message).toContain('does not exist');
    });
  });
});

describe('readRenderedFrame', () => {
  async function renderDirWith(name: string, bytes: Buffer): Promise<{ root: string; file: string }> {
    const home = await mkdtemp(join(tmpdir(), 'ae-mcp-frame-read-'));
    const root = join(home, '.ae-mcp');
    const renderDir = join(root, 'render');
    await mkdir(renderDir, { recursive: true });
    const file = join(renderDir, name);
    await writeFile(file, bytes);
    return { root, file };
  }

  it('downscales an oversized frame through the supplied resizer', async () => {
    const { root, file } = await renderDirWith('big.png', bigFrame(100));
    const smaller = join(root, 'render', 'small.png');
    await writeFile(smaller, FAKE_PNG);

    const read = await readRenderedFrame(root, file, 80, async () => smaller);

    expect(read.ok).toBe(true);
    expect((read as { data: string }).data).toBe(FAKE_PNG.toString('base64'));
  });

  it('reports a frame that stays too large when the resizer declines', async () => {
    const { root, file } = await renderDirWith('big.png', bigFrame(100));

    const read = await readRenderedFrame(root, file, 10, async () => null);

    expect(read.ok).toBe(false);
    expect((read as { message: string }).message).toContain('too large');
  });

  it('reads a frame under the cap without a resizer', async () => {
    const { root, file } = await renderDirWith('small.png', FAKE_PNG);

    const read = await readRenderedFrame(root, file, 10_000);

    expect(read.ok).toBe(true);
    expect((read as { data: string }).data).toBe(FAKE_PNG.toString('base64'));
  });

  // saveFrameToPng returns before AE has written the file (#176).
  it('waits for a frame AE is still writing', async () => {
    const { root, file } = await renderDirWith('late.png', FAKE_PNG.subarray(0, 10));
    setTimeout(() => void writeFile(file, FAKE_PNG), 50);

    const read = await readRenderedFrame(root, file, 10_000, undefined, { timeoutMs: 2_000, intervalMs: 10 });

    expect(read.ok).toBe(true);
    expect((read as { data: string }).data).toBe(FAKE_PNG.toString('base64'));
  });

  // #272: a file that ends in IEND can still be growing; wait until its size stops changing.
  it('returns a frame only once its size has stopped changing', async () => {
    const { root, file } = await renderDirWith('growing.png', bigFrame(10));
    const final = bigFrame(5000);
    setTimeout(() => void writeFile(file, final), 20);

    const read = await readRenderedFrame(root, file, 10_000, undefined, { timeoutMs: 2_000, intervalMs: 100 });

    expect(read.ok).toBe(true);
    expect((read as { data: string }).data).toBe(final.toString('base64'));
  });

  it('waits for a frame that does not exist yet', async () => {
    const { root } = await renderDirWith('other.png', FAKE_PNG);
    const file = join(root, 'render', 'later.png');
    setTimeout(() => void writeFile(file, FAKE_PNG), 50);

    const read = await readRenderedFrame(root, file, 10_000, undefined, { timeoutMs: 2_000, intervalMs: 10 });

    expect(read.ok).toBe(true);
  });

  it('times out on a frame that never completes', async () => {
    const { root, file } = await renderDirWith('stuck.png', FAKE_PNG.subarray(0, 10));

    const read = await readRenderedFrame(root, file, 10_000, undefined, { timeoutMs: 50, intervalMs: 10 });

    expect(read.ok).toBe(false);
    expect((read as { message: string }).message).toContain('not finished writing');
  });
});
