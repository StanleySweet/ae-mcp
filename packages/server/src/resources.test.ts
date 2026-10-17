import { readFileSync, readdirSync } from 'node:fs';
import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { compOperationHandlers, createQueueConsumer, FakeProject, observeHandlers } from '@ae-mcp/fake-bridge';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { createServer } from './server.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SKILL_PATH = join(REPO, 'skills/ae/SKILL.md');
const FINDINGS_DIR = join(REPO, 'docs/findings');

const closes: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closes.length > 0) {
    await closes.pop()!();
  }
});

function project(): FakeProject {
  const project = new FakeProject();
  const comp = project.addComp('Main', 1920, 1080);
  project.addLayer(comp, 'Hero');
  return project;
}

async function connect(fake: FakeProject): Promise<Client> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-resources-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const consumer = createQueueConsumer(
    root,
    { ...observeHandlers(fake), ...compOperationHandlers(fake) },
    10,
  );
  await consumer.start();
  const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({
    root,
    client: aeClient,
    skill: readFileSync(SKILL_PATH, 'utf8'),
    docsDir: FINDINGS_DIR,
  });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  closes.push(async () => {
    await client.close();
    await server.close();
    await consumer.stop();
  });
  return client;
}

function textOf(result: { contents: unknown[] }): string {
  const [first] = result.contents as Array<{ text: string }>;
  return first!.text;
}

describe('MCP resources (#231)', () => {
  it('lists the fixed resources, the findings and the comp template', async () => {
    const client = await connect(project());

    const { resources } = await client.listResources();
    const uris = resources.map((resource) => resource.uri);
    expect(uris).toEqual(
      expect.arrayContaining(['ae://project/items', 'ae://active-comp', 'ae://skill/ae', 'ae://comp/Main']),
    );
    for (const file of readdirSync(FINDINGS_DIR).filter((name) => name.endsWith('.md'))) {
      expect(uris).toContain(`ae://docs/findings/${file}`);
    }

    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate)).toContain('ae://comp/{name}');
  });

  it('reads the project item tree', async () => {
    const client = await connect(project());

    const result = await client.readResource({ uri: 'ae://project/items' });
    expect(result.contents[0]).toMatchObject({ uri: 'ae://project/items', mimeType: 'application/json' });
    expect(JSON.parse(textOf(result))).toMatchObject({ numItems: 1 });
  });

  it('reads the active comp summary with its layers', async () => {
    const client = await connect(project());

    const result = await client.readResource({ uri: 'ae://active-comp' });
    const comp = JSON.parse(textOf(result)) as { name: string };
    expect(comp.name).toBe('Main');
  });

  it('reads the ae skill as markdown', async () => {
    const client = await connect(project());

    const result = await client.readResource({ uri: 'ae://skill/ae' });
    expect(result.contents[0]).toMatchObject({ mimeType: 'text/markdown' });
    expect(textOf(result)).toBe(readFileSync(SKILL_PATH, 'utf8'));
  });

  it('reads each finding file as it is on disk', async () => {
    const client = await connect(project());
    const [file] = readdirSync(FINDINGS_DIR).filter((name) => name.endsWith('.md')).sort();

    const result = await client.readResource({ uri: `ae://docs/findings/${file}` });
    expect(textOf(result)).toBe(readFileSync(join(FINDINGS_DIR, file!), 'utf8'));
  });

  it('reads a composition by name through the template', async () => {
    const client = await connect(project());

    const result = await client.readResource({ uri: 'ae://comp/Main' });
    expect(JSON.parse(textOf(result))).toMatchObject({ name: 'Main', width: 1920 });
  });

  it('fails to read a composition name that does not exist', async () => {
    const client = await connect(project());

    await expect(client.readResource({ uri: 'ae://comp/Nope' })).rejects.toThrow(/composition not found: Nope/);
  });
});
