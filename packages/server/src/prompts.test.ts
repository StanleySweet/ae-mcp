import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createQueueConsumer, FakeProject, observeHandlers } from '@ae-mcp/fake-bridge';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { PROMPT_RECIPES, recipeSection } from './prompts.js';
import { createServer } from './server.js';

const SKILL = readFileSync(fileURLToPath(new URL('../../../skills/ae/SKILL.md', import.meta.url)), 'utf8');

const closes: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closes.length > 0) {
    await closes.pop()!();
  }
});

async function connect(): Promise<Client> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-prompts-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const consumer = createQueueConsumer(root, observeHandlers(new FakeProject()), 10);
  await consumer.start();
  const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ root, client: aeClient, skill: SKILL });
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

function messageText(result: { messages: unknown[] }): string {
  const [message] = result.messages as Array<{ content: { text: string } }>;
  return message!.content.text;
}

describe('MCP prompts (#232)', () => {
  it('lists the four prompts with descriptions and arguments', async () => {
    const client = await connect();

    const { prompts } = await client.listPrompts();
    const names = prompts.map((prompt) => prompt.name);
    expect(names).toEqual(
      expect.arrayContaining(['build-lower-third', 'audit-project', 'seamless-loop', 'title-sequence']),
    );
    const lowerThird = prompts.find((prompt) => prompt.name === 'build-lower-third');
    expect(lowerThird?.description).toBeTruthy();
    expect(lowerThird?.arguments?.map((argument) => argument.name)).toEqual(
      expect.arrayContaining(['title']),
    );
  });

  it('renders a prompt with its arguments from the matching ae skill recipe', async () => {
    const client = await connect();

    const result = await client.getPrompt({
      name: 'build-lower-third',
      arguments: { title: 'Jane Doe', subtitle: 'Director' },
    });

    expect(result.messages[0]).toMatchObject({ role: 'user', content: { type: 'text' } });
    const text = messageText(result);
    expect(text).toContain('"Jane Doe"');
    expect(text).toContain('"Director"');
    expect(text).toContain(recipeSection(SKILL, 'Lower third, title card and transitions'));
  });

  it('builds each prompt from the skill sections it names', async () => {
    for (const recipe of PROMPT_RECIPES) {
      const text = recipe.sections.map((heading) => recipeSection(SKILL, heading)).join('\n\n');
      expect(text.length).toBeGreaterThan(0);
    }
    const client = await connect();

    const result = await client.getPrompt({ name: 'audit-project', arguments: {} });
    expect(messageText(result)).toContain(recipeSection(SKILL, 'Check your work'));
  });

  it('rejects an unknown prompt name', async () => {
    const client = await connect();

    await expect(client.getPrompt({ name: 'no-such-prompt', arguments: {} })).rejects.toThrow();
  });

  it('rejects a recipe section the skill does not have', () => {
    expect(() => recipeSection(SKILL, 'Not a section')).toThrow(/no section/);
  });
});
