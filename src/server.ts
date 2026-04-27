import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getConfigOrThrow } from './config';
import { FlowApiClient } from './api-client';
import { registerFlowTools, registerNodeTools, registerBlockTools } from './tools';

// eslint-disable-next-line @typescript-eslint/no-var-requires -- JSON import for version sync
const { version: VERSION } = require('../package.json');

export const createServer = (): { run: () => Promise<void> } => {
  const config = getConfigOrThrow();
  const client = new FlowApiClient(config);

  const server = new McpServer(
    { name: 'flow-mcp', version: VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        'Eureka Flow MCP server. Typical workflow: ' +
        '1) block_list to discover available block types, ' +
        '2) flow_create to build a new flow with nodes, ' +
        '3) flow_run or node_run to execute, ' +
        '4) node_get_port to inspect results. ' +
        'Always flow_load before flow_save to avoid data loss.',
    },
  );

  registerFlowTools(server, client, config);
  registerNodeTools(server, client, config);
  registerBlockTools(server, client);

  const run = async () => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  };

  return { run };
};
