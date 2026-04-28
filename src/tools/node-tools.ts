import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowApiClient } from '../api-client';
import type { FlowApiConfig } from '../config';
import { executeWithWs, isWsConfigured } from '../ws-client';
import { filterDefined, makeProgressHandler, toolError, toolJson } from './helpers';

export const registerNodeTools = (server: McpServer, client: FlowApiClient, apiConfig: FlowApiConfig) => {
    server.registerTool(
        'node_get',
        {
            title: 'Get Node',
            description:
                'Get a single node by ID. Faster than flow_load when you only need one node. ' +
                'Returns type, config, position, status, and error info.',
            inputSchema: z.object({
                nodeId: z.string().describe('Node ID'),
            }),
            annotations: { readOnlyHint: true },
        },
        async ({ nodeId }) => {
            try {
                const result = await client.getNode(nodeId);
                return toolJson(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'node_create',
        {
            title: 'Create Node',
            description:
                'Add a new node to an existing flow. Use block_list to get blockId and default config. ' +
                'Returns the created node with server-assigned ID. Use edge_create after to connect it.',
            inputSchema: z.object({
                flowId: z.string().describe('Flow ID to add the node to'),
                blockId: z.string().describe('Block ID (e.g., "input-text", "buffer"). Get from block_list.'),
                position: z
                    .optional(z.object({ x: z.number(), y: z.number() }))
                    .describe('Canvas position (default: {x:400, y:300})'),
                config: z
                    .optional(z.record(z.string(), z.string()))
                    .describe('Initial config. Keys from block configSchema.'),
                customLabel: z.optional(z.string()).describe('Display label'),
            }),
        },
        async ({ flowId, blockId, position, config: nodeConfig, customLabel }) => {
            try {
                const result = await client.upsertNode('0', flowId, {
                    blockId,
                    position: position ?? { x: 400, y: 300 },
                    config: nodeConfig ?? {},
                    customLabel,
                    autoExecutionEnabled: true,
                });
                return toolJson(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'node_run',
        {
            title: 'Run Node',
            description:
                'Execute a single node. Requires flowId (get from flow_load). ' +
                'Monitors via WebSocket until complete. Use node_get_port after to inspect output data.',
            inputSchema: z.object({
                nodeId: z.string().describe('Node ID to execute'),
                flowId: z.string().describe('Flow ID containing this node. Get from flow_load.'),
                propagate: z.optional(z.boolean()).describe('Propagate execution to downstream nodes (default: false)'),
                config: z.optional(z.record(z.string(), z.string())).describe('Config overrides for this execution'),
                timeout: z.optional(z.number()).describe('Max wait time in ms (default: 30000)'),
            }),
        },
        async ({ nodeId, flowId, propagate, config: runConfig, timeout }, extra) => {
            try {
                const opts = { propagate: propagate ?? false, config: runConfig };

                if (!isWsConfigured(apiConfig)) {
                    const result = await client.runNode(nodeId, opts);
                    return toolJson(result);
                }

                const startTime = Date.now();

                const { nodeStates, timedOut, eventLog } = await executeWithWs(apiConfig, client, {
                    flowId,
                    expectedNodeIds: [nodeId],
                    timeout: timeout ?? 30_000,
                    onProgress: makeProgressHandler(extra),
                    triggerRun: connectionId =>
                        client.runNode(nodeId, { ...opts, async: true, connection: connectionId }).then(() => {}),
                });

                const status = nodeStates.get(nodeId) ?? 'UNKNOWN';

                const result: Record<string, unknown> = {
                    nodeId,
                    flowId,
                    status,
                    duration: Date.now() - startTime,
                    eventLog,
                };

                if (status === 'ERROR' || timedOut) {
                    const finalFlow = await client.loadFlow(flowId);
                    const node = (finalFlow.nodes ?? []).find(n => n.id === nodeId);
                    if (node?.error || node?.errorMessage) result.error = node.errorMessage ?? node.error;
                    if (timedOut) result.message = `Timed out after ${timeout ?? 30_000}ms. Node status: ${status}`;
                }
                return toolJson(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'node_get_port',
        {
            title: 'Get Port Data',
            description:
                "Get port data (execution result) for a node's input or output. " +
                'Use after node_run to inspect the data flowing through a port.',
            inputSchema: z.object({
                nodeId: z.string().describe('Node ID'),
                portId: z.string().describe('Port ID (e.g., "out", "in")'),
                direction: z.enum(['in', 'out']).describe('Port direction'),
            }),
            annotations: { readOnlyHint: true },
        },
        async ({ nodeId, portId, direction }) => {
            try {
                const result = await client.getPortData(nodeId, portId, direction);
                return toolJson(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'node_update',
        {
            title: 'Update Node',
            description:
                'Update node properties (label, config, position, etc.). Requires flowId. ' +
                'Use flow_load first to get current node data.',
            inputSchema: z.object({
                nodeId: z.string().describe('Node ID to update'),
                flowId: z.string().describe('Flow ID containing this node'),
                customLabel: z.optional(z.string()).describe('Display label (rename the node)'),
                description: z.optional(z.string()).describe('Node description'),
                config: z.optional(z.record(z.string(), z.string())).describe('Config key-value pairs to update'),
                output: z.optional(z.record(z.string(), z.string())).describe('Output port overrides'),
                position: z.optional(z.object({ x: z.number(), y: z.number() })).describe('Canvas position'),
                disabled: z.optional(z.boolean()).describe('Disable/enable the node'),
                blockId: z.optional(z.string()).describe('Change block type reference'),
                errorMessage: z.optional(z.string()).describe('Set error message'),
                autoExecutionEnabled: z.optional(z.boolean()).describe('Enable/disable auto execution'),
            }),
        },
        async ({
            nodeId,
            flowId,
            customLabel,
            description,
            config: nodeConfig,
            output,
            position,
            disabled,
            blockId,
            errorMessage,
            autoExecutionEnabled,
        }) => {
            try {
                const body = filterDefined({
                    customLabel,
                    description,
                    config: nodeConfig,
                    output,
                    position,
                    disabled,
                    blockId,
                    errorMessage,
                    autoExecutionEnabled,
                });
                const result = await client.upsertNode(nodeId, flowId, body);
                return toolJson(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'node_delete',
        {
            title: 'Delete Node',
            description: 'Delete one or more nodes from a flow.',
            inputSchema: z.object({
                flowId: z.string().describe('Flow ID containing the nodes'),
                nodeIds: z.array(z.string()).describe('Node IDs to delete'),
            }),
            annotations: { destructiveHint: true },
        },
        async ({ flowId, nodeIds }) => {
            try {
                await client.upsertFlow(flowId, {
                    nodes: nodeIds.map(id => ({ id: `#${id}` })),
                    edges: [],
                });
                return toolJson({ deleted: nodeIds, flowId });
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'edge_create',
        {
            title: 'Create Edge',
            description: 'Connect two nodes by creating an edge. Use flow_load to get node IDs and port names.',
            inputSchema: z.object({
                flowId: z.string().describe('Flow ID'),
                sourceNodeId: z.string().describe('Source node ID'),
                sourcePortId: z.string().describe('Source port ID (e.g., "out")'),
                targetNodeId: z.string().describe('Target node ID'),
                targetPortId: z.string().describe('Target port ID (e.g., "in")'),
            }),
        },
        async ({ flowId, sourceNodeId, sourcePortId, targetNodeId, targetPortId }) => {
            try {
                const result = await client.upsertFlow(flowId, {
                    nodes: [],
                    edges: [{ id: '', sourceNodeId, sourcePortId, targetNodeId, targetPortId }],
                });
                return toolJson(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'edge_delete',
        {
            title: 'Delete Edge',
            description: 'Delete one or more edges from a flow. Get edge IDs from flow_load.',
            inputSchema: z.object({
                flowId: z.string().describe('Flow ID'),
                edgeIds: z.array(z.string()).describe('Edge IDs to delete'),
            }),
            annotations: { destructiveHint: true },
        },
        async ({ flowId, edgeIds }) => {
            try {
                await client.upsertFlow(flowId, {
                    nodes: [],
                    edges: edgeIds.map(id => ({ id: `#${id}` })),
                });
                return toolJson({ deleted: edgeIds, flowId });
            } catch (e) {
                return toolError(e);
            }
        },
    );
};
