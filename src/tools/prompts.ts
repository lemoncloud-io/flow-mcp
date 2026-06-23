import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * A guided prompt template. Clients surface these in their prompt picker
 * (type `/` in Claude/Cursor) so users can start a common flow workflow in one click.
 *
 * `actions` lists every flow-mcp action the template instructs the model to call.
 * `prompts.test.ts` asserts each one exists in the dispatch action lists, so a
 * renamed/removed action breaks the test instead of shipping a template that
 * tells the model to call a tool that no longer exists.
 */
export type FlowPrompt = {
    name: string;
    description: string;
    actions: readonly string[];
    content: string;
};

export const FLOW_PROMPTS: readonly FlowPrompt[] = [
    {
        name: 'quick-flow',
        description: 'Build and run a simple text input → buffer → preview flow (great first run).',
        actions: ['profile_get', 'block_list', 'flow_create', 'flow_run', 'node_get_port'],
        content: [
            'Help me build my first Eureka Flow, step by step. Do this in order and report after each step:',
            '',
            '1. Call flow_read{action:"profile_get"} to confirm my API key and AI provider are configured.',
            '   If it returns an auth_required error, call auth{action:"login"} and tell me to finish sign-in in the browser, then retry.',
            '2. Call flow_read{action:"block_list"} and pick a text input block, a buffer block, and a preview block.',
            '3. Call flow_do{action:"flow_create"} to create a flow named "Quick Flow" with those three nodes connected: input → buffer → preview.',
            '4. Call flow_do{action:"flow_run"} to execute it and show me the per-node progress.',
            '5. Call flow_read{action:"node_get_port"} on the preview node and show me its output value.',
        ].join('\n'),
    },
    {
        name: 'etl-pipeline',
        description: 'Build a multi-step Extract → Transform → Load flow from a description.',
        actions: ['block_list', 'flow_create', 'node_create', 'edge_create', 'flow_run'],
        content: [
            'Help me build an ETL (Extract → Transform → Load) flow. First ask me what data source, transform, and destination I want.',
            'Then:',
            '',
            '1. Call flow_read{action:"block_list"} to find blocks that match each stage (extract / transform / load).',
            '2. Call flow_do{action:"flow_create"} to create the flow with the extract and load nodes.',
            '3. Call flow_do{action:"node_create"} to add any transform nodes in between.',
            '4. Call flow_do{action:"edge_create"} to wire the stages in order: extract → transform → load.',
            '5. Call flow_do{action:"flow_run"} to test it end to end and report the result of each stage.',
        ].join('\n'),
    },
    {
        name: 'debug-execution',
        description: 'Run a flow, then inspect each node and port to find where it failed.',
        actions: ['flow_load', 'flow_run', 'node_get', 'node_get_port', 'flow_run_from'],
        content: [
            'Help me debug a flow that is not producing the output I expect. Ask me for the flow ID, then:',
            '',
            '1. Call flow_read{action:"flow_load"} to load the flow and show me its nodes and edges.',
            '2. Call flow_do{action:"flow_run"} to run it and capture per-node status.',
            '3. For any node that failed or produced no output, call flow_read{action:"node_get"} and flow_read{action:"node_get_port"} to inspect its config and port values.',
            '4. Explain the likely root cause.',
            '5. After I adjust a node, call flow_do{action:"flow_run_from"} to retry from that node instead of rerunning the whole flow.',
        ].join('\n'),
    },
    {
        name: 'publish-flow',
        description: 'Create (or take an existing) flow and publish it as a public template.',
        actions: ['flow_list', 'flow_load', 'flow_run', 'flow_publish'],
        content: [
            'Help me publish a flow as a public template. Ask whether I want to publish an existing flow or pick one from my list.',
            'Then:',
            '',
            '1. Call flow_read{action:"flow_list"} to show my flows, or flow_read{action:"flow_load"} if I already gave you an ID.',
            '2. Call flow_do{action:"flow_run"} once to confirm it works before publishing.',
            '3. Call flow_do{action:"flow_publish"} to open it to the public, and give me the shareable result.',
            '   Remind me I can make it private again with flow_do{action:"flow_publish"} (isPublic:false).',
        ].join('\n'),
    },
];

/** Register every guided template as an MCP prompt so clients show them in the prompt picker. */
export const registerFlowPrompts = (server: McpServer) => {
    for (const prompt of FLOW_PROMPTS) {
        server.registerPrompt(prompt.name, { title: prompt.name, description: prompt.description }, () => ({
            messages: [{ role: 'user', content: { type: 'text', text: prompt.content } }],
        }));
    }
};
