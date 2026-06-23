import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowApiClient } from '../api-client';
import type { FlowApiConfig } from '../config';
import { executeWithWs, isWsConfigured } from '../ws-client';
import { filterDefined, makeProgressHandler, mcpLog, resolveOutputs, toolError, toolResult } from './helpers';
import { completableFlowId, completableBlockType } from './completions';
import { PassthroughSchema, NodeRunOutputSchema } from './schemas';

export const registerNodeTools = (server: McpServer, client: FlowApiClient, apiConfig: FlowApiConfig) => {
    const flowId = completableFlowId(client);
    const blockType = completableBlockType(client);

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
            outputSchema: PassthroughSchema,
            annotations: { readOnlyHint: true },
        },
        async ({ nodeId }) => {
            try {
                const result = await client.getNode(nodeId);
                return toolResult(result);
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
                flowId,
                blockId: blockType,
                position: z
                    .optional(z.object({ x: z.number(), y: z.number() }))
                    .describe('Canvas position (default: {x:400, y:300})'),
                config: z
                    .optional(z.record(z.string(), z.string()))
                    .describe('Initial config. Keys from block configSchema.'),
                customLabel: z.optional(z.string()).describe('Display label'),
            }),
            outputSchema: PassthroughSchema,
        },
        async ({ flowId, blockId, position, config: nodeConfig, customLabel }) => {
            try {
                // Add the node through the flow graph: upsertFlow MERGES and links it into the flow's
                // node list. A bare POST /nodes/0/upsert creates an orphan node that never joins the
                // flow, so it never shows up on load. Diff before/after to return the new node's id.
                const before = await client.loadFlow(flowId);
                const beforeIds = new Set((before.nodes ?? []).map(n => n.id).filter(Boolean));
                const result = await client.upsertFlow(flowId, {
                    nodes: [
                        filterDefined({
                            // The web app's transformNodeForSave sets BOTH type (processType) and blockId
                            // (blockId ?? type). Mirror it so the backend resolves the block on either key.
                            type: blockId,
                            blockId,
                            position: position ?? { x: 400, y: 300 },
                            config: nodeConfig ?? {},
                            customLabel,
                            autoExecutionEnabled: true,
                        }),
                    ],
                    edges: [],
                });
                const newNode = (result.nodes ?? []).find(n => n.id && !beforeIds.has(n.id));
                return toolResult(newNode ?? result);
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
                flowId,
                propagate: z.optional(z.boolean()).describe('Propagate execution to downstream nodes (default: false)'),
                config: z.optional(z.record(z.string(), z.string())).describe('Config overrides for this execution'),
                timeout: z.optional(z.number()).describe('Max wait time in ms (default: 30000)'),
            }),
            outputSchema: NodeRunOutputSchema,
        },
        async ({ nodeId, flowId, propagate, config: runConfig, timeout }, extra) => {
            try {
                mcpLog(server, 'info', `Starting node execution: ${nodeId} in flow ${flowId}`);

                const opts = { propagate: propagate ?? false, config: runConfig };

                if (!isWsConfigured(apiConfig)) {
                    const result = await client.runNode(nodeId, opts);
                    return toolResult(result);
                }

                const startTime = Date.now();

                // Resolve the flow's WS channel so events arrive even when channelId isn't the '0000' default.
                const channelId = (await client.loadFlow(flowId)).channelId;

                const { nodeStates, timedOut, eventLog } = await executeWithWs(apiConfig, client, {
                    flowId,
                    expectedNodeIds: [nodeId],
                    channelId,
                    timeout: timeout ?? 30_000,
                    onProgress: makeProgressHandler(extra),
                    triggerRun: connectionId =>
                        client.runNode(nodeId, { ...opts, async: true, connection: connectionId }).then(() => {}),
                });

                const status = nodeStates.get(nodeId) ?? 'UNKNOWN';
                const duration = Date.now() - startTime;

                mcpLog(
                    server,
                    timedOut ? 'warning' : 'info',
                    `Node ${nodeId} ${timedOut ? 'timed out' : status} in ${duration}ms`,
                );

                const outputs = await resolveOutputs(client, flowId, eventLog);
                const result: Record<string, unknown> = {
                    nodeId,
                    flowId,
                    status,
                    duration,
                    ...(outputs.length > 0 && { outputs }),
                    eventLog,
                };

                if (status === 'ERROR' || timedOut) {
                    const finalFlow = await client.loadFlow(flowId);
                    const node = (finalFlow.nodes ?? []).find(n => n.id === nodeId);
                    if (node?.error || node?.errorMessage) result.error = node.errorMessage ?? node.error;
                    if (timedOut) result.message = `Timed out after ${timeout ?? 30_000}ms. Node status: ${status}`;
                }
                return toolResult(result);
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
                flowId: z.optional(z.string()).describe('Flow ID (recommended — scopes the lookup)'),
                runId: z
                    .optional(z.string())
                    .describe(
                        'Run ID from a flow_run/node_run eventLog. Port data is run-scoped; omit to read latest.',
                    ),
            }),
            outputSchema: PassthroughSchema,
            annotations: { readOnlyHint: true },
        },
        async ({ nodeId, portId, direction, flowId, runId }) => {
            try {
                const result = await client.getPortData(nodeId, portId, direction, { flowId, runId });
                return toolResult(result);
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
                flowId,
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
            outputSchema: PassthroughSchema,
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
                return toolResult(result);
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
                flowId,
                nodeIds: z.array(z.string()).describe('Node IDs to delete'),
            }),
            outputSchema: PassthroughSchema,
            annotations: { destructiveHint: true },
        },
        async ({ flowId, nodeIds }) => {
            try {
                // Match the canvas: delete a node AND its connected edges in the same upsert, otherwise
                // edges are left dangling at a node that no longer exists. (WorkflowCanvas deleteNode.)
                const idSet = new Set(nodeIds);
                const flow = await client.loadFlow(flowId);
                const danglingEdgeIds = (flow.edges ?? [])
                    .filter(e => e.id && (idSet.has(e.sourceNodeId) || idSet.has(e.targetNodeId)))
                    .map(e => e.id!);

                await client.upsertFlow(flowId, {
                    nodes: nodeIds.map(id => ({ id: `#${id}` })),
                    edges: danglingEdgeIds.map(id => ({ id: `#${id}` })),
                });
                return toolResult({ deleted: nodeIds, deletedEdges: danglingEdgeIds, flowId });
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
                flowId,
                sourceNodeId: z.string().describe('Source node ID'),
                sourcePortId: z.string().describe('Source port ID (e.g., "out")'),
                targetNodeId: z.string().describe('Target node ID'),
                targetPortId: z.string().describe('Target port ID (e.g., "in")'),
            }),
            outputSchema: PassthroughSchema,
        },
        async ({ flowId, sourceNodeId, sourcePortId, targetNodeId, targetPortId }) => {
            try {
                const result = await client.upsertFlow(flowId, {
                    nodes: [],
                    edges: [{ id: '', sourceNodeId, sourcePortId, targetNodeId, targetPortId }],
                });
                return toolResult(result);
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
                flowId,
                edgeIds: z.array(z.string()).describe('Edge IDs to delete'),
            }),
            outputSchema: PassthroughSchema,
            annotations: { destructiveHint: true },
        },
        async ({ flowId, edgeIds }) => {
            try {
                await client.upsertFlow(flowId, {
                    nodes: [],
                    edges: edgeIds.map(id => ({ id: `#${id}` })),
                });
                return toolResult({ deleted: edgeIds, flowId });
            } catch (e) {
                return toolError(e);
            }
        },
    );
};
