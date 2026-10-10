import { queueRoot } from '@ae-mcp/protocol';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createAEClient, type AEClient } from './ae-client.js';
import { buildAeContext } from './context.js';
import { selectTransport, type Runner } from './osascript-transport.js';
import { runSetupChecks } from './setup-checks.js';

export const SERVER_NAME = 'ae-mcp';
export const SERVER_VERSION = '0.0.0';

export interface ServerOptions {
  root?: string;
  applicationsDir?: string;
  appName?: string;
  runner?: Runner;
  client?: AEClient;
}

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

function toResult(value: { ok: boolean; result?: unknown; error?: unknown }): ToolResult {
  if (value.ok) {
    return { content: [{ type: 'text', text: JSON.stringify(value.result) }] };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(value.error) }],
    isError: true,
  };
}

export function createServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const root = options.root ?? queueRoot();

  let clientPromise: Promise<AEClient> | undefined;
  const getClient = (): Promise<AEClient> => {
    if (options.client) {
      return Promise.resolve(options.client);
    }
    clientPromise ??= selectTransport({
      root,
      appName: options.appName,
      runner: options.runner,
    }).then((transport) => createAEClient({ transport, root }));
    return clientPromise;
  };

  const callAE = async (tool: string, args: unknown = null): Promise<ToolResult> => {
    const client = await getClient();
    return toResult(await client.call(tool, args));
  };

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

  server.registerTool(
    'ae_context',
    {
      description:
        'Report the live connection context: active transport, AE and bridge versions, capabilities and busy state.',
      inputSchema: {},
    },
    async () => {
      const context = await buildAeContext(root);
      return { content: [{ type: 'text', text: JSON.stringify(context) }] };
    },
  );

  server.registerTool(
    'ae_project_info',
    {
      description:
        'Report the open project: file, color depth, item count, active item and every item summary.',
      inputSchema: {},
    },
    () => callAE('ae_project_info'),
  );

  return server;
}
