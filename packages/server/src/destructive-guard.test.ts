import { chmod, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer, FakeProject, HandlerError, observeHandlers } from '@ae-mcp/fake-bridge';
import { errorSchema } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { OperationRegistry } from './operations.js';
import { createServer } from './server.js';
import type { Settings } from './settings.js';

function registry(): OperationRegistry {
  const registry = new OperationRegistry();
  registry.register({
    name: 'layer.rename',
    category: 'layer',
    description: 'Rename a layer.',
    readOnly: false,
    destructive: false,
    schema: { index: { type: 'number' }, name: { type: 'string' } },
  });
  registry.register({
    name: 'layer.delete',
    category: 'layer',
    description: 'Delete a layer.',
    readOnly: false,
    destructive: true,
    schema: { index: { type: 'number' } },
  });
  registry.register({
    name: 'batch.run',
    category: 'batch',
    description: 'Run many operations as one undo step.',
    readOnly: false,
    destructive: false,
    schema: {
      ops: { type: 'array', items: { type: 'object' } },
      atomic: { type: 'boolean' },
    },
  });
  return registry;
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    readOnly: false,
    allowedCategories: null,
    evalEnabled: false,
    incrementBeforeDestructive: true,
    ...overrides,
  };
}

interface HarnessOptions {
  incrementResult?: unknown;
  settings?: Settings;
  operations?: OperationRegistry;
  extraHandlers?: Record<string, (args?: unknown) => unknown>;
}

async function connectServer(
  project: FakeProject,
  calls: string[],
  options: HarnessOptions = {},
): Promise<{ client: Client; close: () => Promise<void>; home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-guard-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);

  const handlers: Record<string, (args?: unknown) => unknown> = {
    ...observeHandlers(project),
    'project.increment_save': () => {
      calls.push('project.increment_save');
      // The bridge raises UNSAVED_PROJECT / other errors instead of returning them (#181).
      if (options.incrementResult instanceof Error) {
        throw options.incrementResult;
      }
      return options.incrementResult ?? { success: true, file: '/projects/P_v008.aep' };
    },
    'layer.rename': (args: unknown) => {
      calls.push('layer.rename');
      return args;
    },
    'layer.delete': (args: unknown) => {
      calls.push('layer.delete');
      return { deleted: (args as { index: number }).index };
    },
    'batch.run': () => {
      calls.push('batch.run');
      return { results: [] };
    },
    ...options.extraHandlers,
  };
  const consumer = createQueueConsumer(root, handlers);
  await consumer.start();

  const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({
    root,
    client: aeClient,
    operations: options.operations ?? registry(),
    settings: options.settings ?? settings(),
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
    home,
  };
}

async function call(
  client: Client,
  op: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name: 'ae_do', arguments: { op, args } });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return { isError: result.isError === true, text: first!.text };
}

function project(): FakeProject {
  const project = new FakeProject();
  const comp = project.addComp('Main', 1920, 1080);
  project.addLayer(comp, 'Layer 1');
  return project;
}

describe('E13-3 destructive guard', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  it('increments the project before a destructive operation', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const result = await call(client, 'layer.delete', { index: 1 });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['project.increment_save', 'layer.delete']);
  });

  it('does not increment before a non-destructive operation', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const result = await call(client, 'layer.rename', { index: 1, name: 'Hero' });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['layer.rename']);
  });

  it('refuses a destructive operation when the project has never been saved', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      incrementResult: new HandlerError('UNSAVED_PROJECT', 'project has never been saved'),
    });
    closes.push(close);

    const result = await call(client, 'layer.delete', { index: 1 });
    expect(result.isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(result.text));
    expect(error.code).toBe('UNSAVED_PROJECT');
    expect(calls).toEqual(['project.increment_save']);
  });

  it('surfaces the real increment error instead of blaming an unsaved project', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      incrementResult: new HandlerError('SCRIPT_ERROR', 'the installed bridge payload is stale'),
    });
    closes.push(close);

    const result = await call(client, 'layer.delete', { index: 1 });
    expect(result.isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(result.text));
    expect(error.code).toBe('SCRIPT_ERROR');
    expect(error.message).toContain('the installed bridge payload is stale');
    expect(calls).toEqual(['project.increment_save']);
  });

  it('skips the increment when incrementBeforeDestructive is off', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      settings: settings({ incrementBeforeDestructive: false }),
    });
    closes.push(close);

    const result = await call(client, 'layer.delete', { index: 1 });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['layer.delete']);
  });

  it('increments once for a batch.run with a destructive sub-operation', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const result = await call(client, 'batch.run', {
      ops: [
        { op: 'layer.rename', args: { index: 1, name: 'Hero' } },
        { op: 'layer.delete', args: { index: 1 } },
      ],
    });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['project.increment_save', 'batch.run']);
  });

  it('sends server-computed mutating flags with batch.run', async () => {
    const calls: string[] = [];
    const seen: unknown[] = [];
    const operations = registry();
    operations.register({
      name: 'layer.info',
      category: 'layer',
      description: 'Read a layer.',
      readOnly: true,
      destructive: false,
      schema: { index: { type: 'number' } },
    });
    const { client, close } = await connectServer(project(), calls, {
      operations,
      extraHandlers: {
        'layer.info': () => ({}),
        'batch.run': (args: unknown) => {
          seen.push(args);
          return { results: [] };
        },
      },
    });
    closes.push(close);

    const result = await call(client, 'batch.run', {
      ops: [
        { op: 'layer.info', args: { index: 1 } },
        { op: 'layer.rename', args: { index: 1, name: 'Hero' } },
      ],
      atomic: false,
    });
    expect(result.isError).toBe(false);
    expect(seen).toEqual([expect.objectContaining({ atomic: false, mutating: [false, true] })]);
  });

  it('increments exactly once for a batch.run with several destructive sub-operations', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const result = await call(client, 'batch.run', {
      ops: [
        { op: 'layer.delete', args: { index: 1 } },
        { op: 'layer.delete', args: { index: 2 } },
      ],
    });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['project.increment_save', 'batch.run']);
  });

  it('does not increment for a batch.run without destructive sub-operations', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const result = await call(client, 'batch.run', {
      ops: [{ op: 'layer.rename', args: { index: 1, name: 'Hero' } }],
    });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['batch.run']);
  });

  it('refuses a batch.run with a destructive sub-operation when the project has never been saved', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      incrementResult: new HandlerError('UNSAVED_PROJECT', 'project has never been saved'),
    });
    closes.push(close);

    const result = await call(client, 'batch.run', {
      ops: [{ op: 'layer.delete', args: { index: 1 } }],
    });
    expect(result.isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(result.text));
    expect(error.code).toBe('UNSAVED_PROJECT');
    expect(calls).toEqual(['project.increment_save']);
  });

  it('increments before applying a destructive bulk plan', async () => {
    const calls: string[] = [];
    const registryWithBulk = registry();
    registryWithBulk.register({
      name: 'bulk.remove_unused',
      category: 'bulk',
      description: 'Remove unused items.',
      readOnly: false,
      destructive: true,
      schema: { dryRun: { type: 'boolean' } },
    });
    const home = await mkdtemp(join(tmpdir(), 'ae-mcp-guard-bulk-'));
    const root = join(home, '.ae-mcp');
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);

    const handlers = {
      ...observeHandlers(project()),
      'project.increment_save': () => {
        calls.push('project.increment_save');
        return { success: true, file: '/projects/P_v008.aep' };
      },
      'bulk.remove_unused': (args: unknown) => {
        calls.push('bulk.remove_unused');
        const dry = (args as { dryRun?: boolean })?.dryRun;
        if (dry) {
          return { changes: [], fingerprint: 'fp-bulk' };
        }
        return { removed: 0 };
      },
    };
    const consumer = createQueueConsumer(root, handlers);
    await consumer.start();

    const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
      root,
      client: aeClient,
      operations: registryWithBulk,
      settings: settings(),
    });
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const plan = await client.callTool({ name: 'ae_plan', arguments: { op: 'bulk.remove_unused', args: {} } });
    const planText = (plan.content as Array<{ type: string; text: string }>)[0]!.text;
    const planId = JSON.parse(planText).planId;
    expect(plan.isError).toBe(false);

    const applied = await client.callTool({ name: 'ae_apply', arguments: { planId } });
    const appliedText = (applied.content as Array<{ type: string; text: string }>)[0]!.text;
    const appliedPayload = JSON.parse(appliedText);
    expect(applied.isError).toBe(false);
    expect(calls).toEqual([
      'bulk.remove_unused',
      'bulk.remove_unused',
      'project.increment_save',
      'bulk.remove_unused',
    ]);
    expect(appliedPayload.increment).toEqual({ incrementedFile: '/projects/P_v008.aep' });

    await client.close();
    await server.close();
    await consumer.stop();
  });

  it('refuses a bulk apply with a destructive plan when the project has never been saved', async () => {
    const calls: string[] = [];
    const registryWithBulk = registry();
    registryWithBulk.register({
      name: 'bulk.remove_unused',
      category: 'bulk',
      description: 'Remove unused items.',
      readOnly: false,
      destructive: true,
      schema: { dryRun: { type: 'boolean' } },
    });
    const home = await mkdtemp(join(tmpdir(), 'ae-mcp-guard-bulk2-'));
    const root = join(home, '.ae-mcp');
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);

    const handlers = {
      ...observeHandlers(project()),
      'project.increment_save': () => {
        calls.push('project.increment_save');
        throw new HandlerError('UNSAVED_PROJECT', 'project has never been saved');
      },
      'bulk.remove_unused': (args: unknown) => {
        calls.push('bulk.remove_unused');
        const dry = (args as { dryRun?: boolean })?.dryRun;
        if (dry) {
          return { changes: [], fingerprint: 'fp-bulk2' };
        }
        return { removed: 0 };
      },
    };
    const consumer = createQueueConsumer(root, handlers);
    await consumer.start();

    const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
      root,
      client: aeClient,
      operations: registryWithBulk,
      settings: settings(),
    });
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const plan = await client.callTool({ name: 'ae_plan', arguments: { op: 'bulk.remove_unused', args: {} } });
    const planText = (plan.content as Array<{ type: string; text: string }>)[0]!.text;
    const planId = JSON.parse(planText).planId;

    const applied = await client.callTool({ name: 'ae_apply', arguments: { planId } });
    expect(applied.isError).toBe(true);
    const error = errorSchema.parse(JSON.parse((applied.content as Array<{ type: string; text: string }>)[0]!.text));
    expect(error.code).toBe('UNSAVED_PROJECT');
    expect(calls).toEqual(['bulk.remove_unused', 'bulk.remove_unused', 'project.increment_save']);

    await client.close();
    await server.close();
    await consumer.stop();
  });

  it('cannot bypass the guard through eval.run', async () => {
    const calls: string[] = [];
    const registryWithEval = registry();
    registryWithEval.register({
      name: 'eval.run',
      category: 'eval',
      description: 'Run arbitrary ExtendScript.',
      readOnly: false,
      destructive: true,
      schema: { code: { type: 'string' } },
    });
    const proj = project();
    const home = await mkdtemp(join(tmpdir(), 'ae-mcp-guard-eval-'));
    const root = join(home, '.ae-mcp');
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);

    const handlers: Record<string, (args?: unknown) => unknown> = {
      ...observeHandlers(proj),
      'project.increment_save': () => {
        calls.push('project.increment_save');
        throw new HandlerError('UNSAVED_PROJECT', 'project has never been saved');
      },
      'layer.rename': (args: unknown) => {
        calls.push('layer.rename');
        return args;
      },
      'layer.delete': (args: unknown) => {
        calls.push('layer.delete');
        return { deleted: (args as { index: number }).index };
      },
      'batch.run': () => {
        calls.push('batch.run');
        return { results: [] };
      },
      'eval.run': () => {
        calls.push('eval.run');
        return { ok: true };
      },
    };
    const consumer = createQueueConsumer(root, handlers);
    await consumer.start();

    const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
      root,
      client: aeClient,
      operations: registryWithEval,
      settings: settings({ evalEnabled: true }),
    });
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);
    closes.push(async () => {
      await client.close();
      await server.close();
      await consumer.stop();
    });

    const result = await call(client, 'eval.run', { code: '1+1' });
    expect(result.isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(result.text));
    expect(error.code).toBe('UNSAVED_PROJECT');
    expect(calls).toEqual(['project.increment_save']);
  });
});

describe('E13-5 saved version path reporting', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  it('ae_do includes increment.incrementedFile and persists the path for check_setup', async () => {
    const calls: string[] = [];
    const { client, close, home } = await connectServer(project(), calls);
    closes.push(close);

    const result = await call(client, 'layer.delete', { index: 1 });
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.text);
    expect(parsed.increment).toEqual({ incrementedFile: '/projects/P_v008.aep' });

    const savedVersion = await readFile(join(home, '.ae-mcp', 'bridge', 'last-saved-version'), 'utf8');
    expect(savedVersion.trim()).toBe('/projects/P_v008.aep');
  });

  // An empty untitled project is skipped by the bridge with file: null (#204): the
  // destructive op runs and nothing is reported as incremented.
  it('runs the destructive op and reports no increment when the bridge skipped an empty untitled project', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      incrementResult: { success: true, file: null, skipped: 'empty untitled project' },
    });
    closes.push(close);

    const result = await call(client, 'layer.delete', { index: 1 });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text).increment).toBeUndefined();
    expect(calls).toEqual(['project.increment_save', 'layer.delete']);
  });
});

// E16-6: project.new with force discards the open project, so the guard protects it only when
// it has unsaved changes or was never saved. A saved, clean project has nothing to lose.
describe('E16-6 project.new with force', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  function newRegistry(): OperationRegistry {
    const registry = new OperationRegistry();
    registry.register({
      name: 'project.new',
      category: 'project',
      description: 'Open a fresh untitled project.',
      readOnly: false,
      destructive: true,
      schema: { force: { type: 'boolean' } },
    });
    return registry;
  }

  function projectInfo(info: Record<string, unknown>): Record<string, (args?: unknown) => unknown> {
    return {
      'project.info': () => info,
      'project.new': () => {
        return { numItems: 0 };
      },
    };
  }

  it('skips the increment save when the project is saved and clean', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      operations: newRegistry(),
      extraHandlers: projectInfo({ file: '/projects/P.aep', dirty: false }),
    });
    closes.push(close);

    const result = await call(client, 'project.new', { force: true });
    expect(result.isError).toBe(false);
    expect(calls).toEqual([]);
  });

  it('keeps the increment save when the project has unsaved changes', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      operations: newRegistry(),
      extraHandlers: projectInfo({ file: '/projects/P.aep', dirty: true }),
    });
    closes.push(close);

    const result = await call(client, 'project.new', { force: true });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['project.increment_save']);
  });

  it('keeps refusing when a never-saved project has content', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      operations: newRegistry(),
      incrementResult: new HandlerError('UNSAVED_PROJECT', 'project has never been saved'),
      extraHandlers: projectInfo({ file: null, dirty: true }),
    });
    closes.push(close);

    const result = await call(client, 'project.new', { force: true });
    expect(result.isError).toBe(true);
    expect(errorSchema.parse(JSON.parse(result.text)).code).toBe('UNSAVED_PROJECT');
    expect(calls).toEqual(['project.increment_save']);
  });

  it('keeps the guard without force', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      operations: newRegistry(),
      extraHandlers: projectInfo({ file: '/projects/P.aep', dirty: false }),
    });
    closes.push(close);

    await call(client, 'project.new', {});
    expect(calls).toEqual(['project.increment_save']);
  });
});

describe('E13-6 guard cannot be bypassed', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  function registryWithEval(): OperationRegistry {
    const registryWithEvalOp = registry();
    registryWithEvalOp.register({
      name: 'eval.run',
      category: 'eval',
      description: 'Run arbitrary ExtendScript.',
      readOnly: false,
      destructive: true,
      schema: { code: { type: 'string' } },
    });
    return registryWithEvalOp;
  }

  function evalHandlers(calls: string[]): Record<string, (args?: unknown) => unknown> {
    return {
      'eval.run': () => {
        calls.push('eval.run');
        return { ok: true };
      },
    };
  }

  it('increments before eval.run when the project is saved', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      operations: registryWithEval(),
      settings: settings({ evalEnabled: true }),
      extraHandlers: evalHandlers(calls),
    });
    closes.push(close);

    const result = await call(client, 'eval.run', { code: '1+1' });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['project.increment_save', 'eval.run']);
    expect(JSON.parse(result.text).increment).toEqual({ incrementedFile: '/projects/P_v008.aep' });
  });

  it('cannot smuggle a destructive eval.run through batch.run', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      operations: registryWithEval(),
      settings: settings({ evalEnabled: true }),
      extraHandlers: evalHandlers(calls),
    });
    closes.push(close);

    const result = await call(client, 'batch.run', {
      ops: [{ op: 'eval.run', args: { code: '1+1' } }],
    });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['project.increment_save', 'batch.run']);
  });

  it('cannot smuggle a destructive eval.run through batch.run when the project is unsaved', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      operations: registryWithEval(),
      settings: settings({ evalEnabled: true }),
      incrementResult: new HandlerError('UNSAVED_PROJECT', 'project has never been saved'),
      extraHandlers: evalHandlers(calls),
    });
    closes.push(close);

    const result = await call(client, 'batch.run', {
      ops: [{ op: 'eval.run', args: { code: '1+1' } }],
    });
    expect(result.isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(result.text));
    expect(error.code).toBe('UNSAVED_PROJECT');
    expect(calls).toEqual(['project.increment_save']);
  });
});
