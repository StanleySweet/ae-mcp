import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [tool, argsJson] = process.argv.slice(2);
if (!tool) {
  console.error('usage: live-test.ts <tool> [argsJson]');
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', 'packages/server/src/index.ts'],
  cwd: process.cwd(),
  stderr: 'inherit',
});
const client = new Client({ name: 'live-test', version: '0.0.0' });
await client.connect(transport);

try {
  const args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  const result = await client.callTool({ name: tool, arguments: args });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.close();
}