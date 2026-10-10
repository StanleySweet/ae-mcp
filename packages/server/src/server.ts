import { queueRoot } from '@ae-mcp/protocol';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runSetupChecks } from './setup-checks.js';

export const SERVER_NAME = 'ae-mcp';
export const SERVER_VERSION = '0.0.0';

export interface ServerOptions {
  root?: string;
  applicationsDir?: string;
}

export function createServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const root = options.root ?? queueRoot();

  server.registerTool(
    'check_setup',
    {
      description:
        'Report whether After Effects, the bridge and queue permissions are ready, with a fix for each failed check.',
      inputSchema: {},
    },
    async () => {
      const checks = await runSetupChecks({
        root,
        applicationsDir: options.applicationsDir,
      });
      return { content: [{ type: 'text', text: JSON.stringify(checks) }] };
    },
  );

  return server;
}