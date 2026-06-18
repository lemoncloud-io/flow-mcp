import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getConfigOrThrow } from './config';
import { FlowApiClient } from './api-client';
import { CredentialStore } from './auth/credentials';
import { registerDispatchTools } from './tools';

const { version: VERSION } = require('../package.json');

export const createServer = (): { run: () => Promise<void> } => {
    const config = getConfigOrThrow();
    const credentials = new CredentialStore(config.FLOW_API_KEY);
    const client = new FlowApiClient(config, credentials);

    const server = new McpServer(
        { name: 'flow-mcp', version: VERSION },
        {
            capabilities: { tools: {}, logging: {} },
            instructions:
                'Eureka Flow MCP server. Auth: a single FLOW_API_KEY (x-api-key) unlocks both flows and credits ' +
                '(flow.eureka.codes + billing.eureka.codes). ' +
                'Four tools, split by domain × access: flow_read (read-only flows/nodes/blocks/runs), ' +
                'flow_do (create/run/edit flows + nodes/edges), credit_read (read-only credits), ' +
                'credit_do (purchase credits). Each takes { action, params } — pick the action from the tool description. ' +
                'Typical workflow: ' +
                '0) flow_read{action:"profile_get"} → verify your API key + AI provider config (required for execution), ' +
                '1) flow_read{action:"block_list"} → discover block types, ' +
                '2) flow_do{action:"flow_create"} → build a new flow, ' +
                '3) flow_do{action:"flow_run"} → execute, ' +
                '4) flow_read{action:"node_get_port"} → inspect results, ' +
                '5) flow_do{action:"flow_publish"} → open the flow as public. ' +
                'Credits: credit_read{action:"credit_balance"|"credit_packs"|"credit_history"}, ' +
                'credit_do{action:"credit_purchase"} (card on file). ' +
                'IMPORTANT: to modify existing flows use action node_update / node_delete (flow_do). ' +
                'Do NOT use flow_save for edits — it replaces ALL nodes with new IDs, breaking edges. ' +
                'Use flow_clone to duplicate, flow_export for portable JSON, flow_run_from to retry from a node.',
        },
    );

    registerDispatchTools(server, client, config);

    const run = async () => {
        const transport = new StdioServerTransport();
        await server.connect(transport);
    };

    return { run };
};
