import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getConfigOrThrow } from './config';
import { FlowApiClient } from './api-client';
import {
    registerFlowTools,
    registerNodeTools,
    registerBlockTools,
    registerRunTools,
    registerCreditTools,
} from './tools';

const { version: VERSION } = require('../package.json');

export const createServer = (): { run: () => Promise<void> } => {
    const config = getConfigOrThrow();
    const client = new FlowApiClient(config);

    const server = new McpServer(
        { name: 'flow-mcp', version: VERSION },
        {
            capabilities: { tools: {}, logging: {} },
            instructions:
                'Eureka Flow MCP server. Auth: a single FLOW_API_KEY (x-api-key) unlocks both flows and credits ' +
                '(flow.eureka.codes + billing.eureka.codes). Typical workflow: ' +
                '0) profile_get → verify your API key + AI provider config (required for execution), ' +
                '1) block_list → discover block types, ' +
                '2) flow_create → build a new flow, ' +
                '3) flow_run/node_run → execute, ' +
                '4) node_get_port → inspect results, ' +
                '5) flow_publish → open the flow as public. ' +
                'Credits: credit_balance (check), credit_packs + credit_purchase (top up via card on file), ' +
                'credit_history (review spend). ' +
                'IMPORTANT: To modify existing flows, use node_update (change config/label) and node_delete (remove nodes). ' +
                'Do NOT use flow_save for modifications — it replaces ALL nodes with new IDs, breaking edges. ' +
                'Use flow_clone to duplicate, flow_export to get portable JSON, flow_run_from to retry from a specific node.',
        },
    );

    registerFlowTools(server, client, config);
    registerNodeTools(server, client, config);
    registerBlockTools(server, client);
    registerRunTools(server, client);
    registerCreditTools(server, client);

    const run = async () => {
        const transport = new StdioServerTransport();
        await server.connect(transport);
    };

    return { run };
};
