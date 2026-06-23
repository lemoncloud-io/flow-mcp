import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowApiClient } from '../api-client';
import type { FlowApiConfig } from '../config';
import { executeWithWs, isWsConfigured } from '../ws-client';
import { TERMINAL_STATES } from '../types';
import type { EdgeData } from '../types';
import {
    filterDefined,
    flowWebUrl,
    makeProgressHandler,
    mcpLog,
    resolveOutputs,
    stripNodeRuntime,
    toolError,
    toolResult,
} from './helpers';
import { completableFlowId } from './completions';
import {
    PassthroughSchema,
    ProfileOutputSchema,
    FlowListOutputSchema,
    FlowGraphOutputSchema,
    FlowExportOutputSchema,
    FlowRunOutputSchema,
} from './schemas';

const NodeDataSchema = z.object({
    id: z
        .optional(z.string())
        .describe('Existing node ID. Pass it to preserve the node (and its edges) across a save; omit for new nodes.'),
    blockId: z
        .optional(z.string())
        .describe('Block ID (from block_list). Preserve it so the backend resolves the block.'),
    type: z.string().describe('Block process type (e.g., "input-text", "text-transform"). Get from block_list.'),
    position: z.object({ x: z.number(), y: z.number() }).describe('Canvas position'),
    config: z
        .optional(z.record(z.string(), z.string()))
        .describe('Node config key-value pairs. Keys from block configSchema.'),
    customLabel: z.optional(z.string()),
});

const EdgeDataSchema = z.object({
    sourceNodeId: z.string().describe('Source node ID or array index (e.g., "0", "1") when creating.'),
    sourcePortId: z.string().describe('Source port ID (e.g., "out"). Get from block outputs.'),
    targetNodeId: z.string().describe('Target node ID or array index when creating.'),
    targetPortId: z.string().describe('Target port ID (e.g., "in"). Get from block inputs.'),
});

/** Remap edge node IDs from old IDs to index-based refs */
const remapEdgesToIndices = (edges: EdgeData[], nodes: Array<{ id?: string }>) => {
    const idToIndex = new Map(nodes.map((n, i) => [n.id, String(i)]));
    return edges.map(e => ({
        sourceNodeId: idToIndex.get(e.sourceNodeId) ?? e.sourceNodeId,
        sourcePortId: e.sourcePortId,
        targetNodeId: idToIndex.get(e.targetNodeId) ?? e.targetNodeId,
        targetPortId: e.targetPortId,
    }));
};

interface RunResultOpts {
    client: FlowApiClient;
    webBaseUrl: string;
    flowId: string;
    expectedNodeIds: string[];
    nodeStates: Map<string, string>;
    timedOut: boolean;
    startTime: number;
    eventLog: Array<Record<string, unknown>>;
    timeout?: number;
    startNodeId?: string;
}

/** Build execution result from WS states, re-fetching on error/timeout */
const buildRunResult = async (opts: RunResultOpts) => {
    const {
        client,
        webBaseUrl,
        flowId,
        expectedNodeIds,
        nodeStates,
        timedOut,
        startTime,
        eventLog,
        timeout,
        startNodeId,
    } = opts;
    const hasError = [...nodeStates.values()].some(s => s === 'ERROR');
    let nodes = expectedNodeIds.map(id => ({
        id,
        status: nodeStates.get(id) ?? 'UNKNOWN',
        error: undefined as string | undefined,
    }));

    if (hasError || timedOut) {
        const finalFlow = await client.loadFlow(flowId);
        nodes = (finalFlow.nodes ?? [])
            .filter(n => expectedNodeIds.includes(n.id ?? ''))
            .map(n => ({
                id: n.id ?? '',
                status: nodeStates.get(n.id ?? '') ?? n.status ?? 'UNKNOWN',
                error: n.errorMessage ?? n.error,
            }));
    }

    const status = timedOut ? 'timeout' : hasError ? 'error' : 'completed';
    // Resolve the real out-port values from the run so callers see the result text directly.
    const outputs = await resolveOutputs(client, flowId, eventLog);
    return toolResult({
        flowId,
        url: flowWebUrl(webBaseUrl, flowId),
        ...(startNodeId && { startNodeId }),
        status,
        nodes,
        ...(outputs.length > 0 && { outputs }),
        duration: Date.now() - startTime,
        eventLog,
        ...(timedOut && {
            message: `Timed out after ${timeout ?? 60_000}ms. ${nodes.filter(n => TERMINAL_STATES.has(n.status)).length}/${expectedNodeIds.length} nodes completed.`,
        }),
    });
};

export const registerFlowTools = (server: McpServer, client: FlowApiClient, apiConfig: FlowApiConfig) => {
    const flowId = completableFlowId(client);
    const urlFor = (id: string) => flowWebUrl(apiConfig.FLOW_WEB_URL, id);
    // Attach the web console link to a flow-shaped result so clients can surface a clickable URL.
    const withUrl = <T extends { id?: string }>(flow: T): T | (T & { url: string }) =>
        flow.id ? { ...flow, url: urlFor(flow.id) } : flow;

    server.registerTool(
        'profile_get',
        {
            title: 'Get Profile',
            description:
                'Check user profile and API key configuration status. ' +
                'Returns whether geminiApiKey and openaiApiKey are configured. ' +
                'These keys are required for flow execution — if missing, flows cannot run.',
            inputSchema: z.object({}),
            outputSchema: ProfileOutputSchema,
            annotations: { readOnlyHint: true },
        },
        async () => {
            try {
                const profile = await client.getProfile();
                return toolResult({
                    sid: profile.sid,
                    uid: profile.uid,
                    hasGeminiApiKey: !!profile.geminiApiKey,
                    hasOpenaiApiKey: !!profile.openaiApiKey,
                });
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'flow_list',
        {
            title: 'List Flows',
            description: "List user's flows. Use this first to see available flows before loading or running them.",
            inputSchema: z.object({
                isPublic: z.optional(z.boolean()).describe('List public flows instead of your own'),
                page: z.optional(z.number().int().min(0)).describe('Page number (0-based, default: 0)'),
            }),
            outputSchema: FlowListOutputSchema,
            annotations: { readOnlyHint: true },
        },
        async ({ isPublic, page }) => {
            try {
                const result = await client.listFlows({ isPublic, page });
                const summary = result.list.map(f => ({
                    id: f.id,
                    name: f.name,
                    state: f.state,
                    status: f.status,
                    isPublic: f.isPublic,
                    modifiedAt: f.modifiedAt,
                    ...(f.id && { url: urlFor(f.id) }),
                }));
                return toolResult({ total: result.total, page: result.page ?? page ?? 0, flows: summary });
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'flow_load',
        {
            title: 'Load Flow',
            description:
                "Load flow with full canvas state (nodes, edges, ports). Use to inspect a flow's structure before modifying.",
            inputSchema: z.object({ flowId }),
            outputSchema: PassthroughSchema,
            annotations: { readOnlyHint: true },
        },
        async ({ flowId }) => {
            try {
                const flow = await client.loadFlow(flowId);
                return toolResult(withUrl(flow));
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'flow_graph',
        {
            title: 'Flow Graph',
            description:
                'Visualize flow as a Mermaid diagram with node statuses, data values, and execution stats. ' +
                'Shows the complete graph structure at a glance.',
            inputSchema: z.object({ flowId }),
            outputSchema: FlowGraphOutputSchema,
            annotations: { readOnlyHint: true },
        },
        async ({ flowId }) => {
            try {
                const flow = await client.loadFlow(flowId);
                const nodes = flow.nodes ?? [];
                const edges = flow.edges ?? [];
                const ports = flow.ports ?? [];

                const icon = (s?: string) =>
                    s === 'COMPLETED' ? '✅' : s === 'ERROR' ? '❌' : s === 'RUNNING' ? '🔄' : '⚪';

                const mermaid = [
                    'graph LR',
                    ...nodes.map(n => {
                        const label = (n.customLabel ?? n.type ?? n.id ?? '').replace(/"/g, "'");
                        return `  ${n.id}["${icon(n.status)} ${label}"]`;
                    }),
                    ...edges.map(e => `  ${e.sourceNodeId} --> ${e.targetNodeId}`),
                ].join('\n');

                const connectedIds = new Set([...edges.map(e => e.sourceNodeId), ...edges.map(e => e.targetNodeId)]);
                const orphans = nodes.filter(n => !connectedIds.has(n.id!));
                const portValues = ports
                    .filter(p => p.data?.value)
                    .map(p => `${p.id}: ${JSON.stringify(p.data!.value)}`);

                const summary = [
                    `# ${flow.name ?? flowId}`,
                    `🔗 ${urlFor(flowId)}`,
                    '',
                    '```mermaid',
                    mermaid,
                    '```',
                    '',
                    `**Nodes:** ${nodes.map(n => `${icon(n.status)}${n.customLabel ?? n.type}(${n.id})`).join(' → ')}`,
                    portValues.length ? `**Data:** ${portValues.join(' | ')}` : '',
                    orphans.length
                        ? `**Orphans:** ${orphans.map(n => `${n.id}(${n.customLabel ?? n.type})`).join(', ')}`
                        : '',
                    nodes.some(n => n.error || n.errorMessage)
                        ? `**Errors:** ${nodes
                              .filter(n => n.error || n.errorMessage)
                              .map(n => `${n.id}: ${n.errorMessage ?? n.error}`)
                              .join(', ')}`
                        : '',
                ]
                    .filter(Boolean)
                    .join('\n');

                return {
                    content: [{ type: 'text' as const, text: summary }],
                    structuredContent: { flowId, url: urlFor(flowId), mermaid },
                };
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'flow_create',
        {
            title: 'Create Flow',
            description:
                'Create a new flow with nodes and edges. Use block_list first to discover available block types. ' +
                'If edges are provided with index-based node IDs (e.g., "0", "1"), they are auto-resolved to real IDs after node creation.',
            inputSchema: z.object({
                name: z.string().describe('Flow name'),
                description: z.optional(z.string()),
                nodes: z.array(NodeDataSchema).optional().describe('Initial nodes.'),
                edges: z
                    .array(EdgeDataSchema)
                    .optional()
                    .describe(
                        'Connections between nodes. Use array index as node ID (e.g., "0" for first node) — resolved to real IDs internally.',
                    ),
            }),
            outputSchema: PassthroughSchema,
        },
        async ({ name, description, nodes, edges }) => {
            try {
                // SaveFlowBody is { nodes, edges } only — the web app sets name/description via the
                // metadata upsert endpoint, NOT the save body. Save the graph first, then upsert metadata.
                const created = await client.saveFlow('0', { nodes: nodes ?? [], edges: [] });

                let result = created;
                if (edges?.length && created.nodes?.length) {
                    const realNodes = created.nodes;
                    const resolvedEdges = edges.map(e => ({
                        sourceNodeId: resolveNodeId(e.sourceNodeId, realNodes),
                        sourcePortId: e.sourcePortId,
                        targetNodeId: resolveNodeId(e.targetNodeId, realNodes),
                        targetPortId: e.targetPortId,
                    }));
                    result = await client.saveFlow(created.id, { nodes: realNodes, edges: resolvedEdges });
                }

                if (name !== undefined || description !== undefined) {
                    result = await client.upsertFlow(created.id, filterDefined({ name, description }));
                }

                return toolResult(withUrl(result));
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'flow_update',
        {
            title: 'Update Flow',
            description:
                'Update flow metadata (name, description) without touching nodes or edges. Safe to use anytime.',
            inputSchema: z.object({
                flowId,
                name: z.optional(z.string()).describe('New flow name'),
                description: z.optional(z.string()).describe('New flow description'),
            }),
            outputSchema: PassthroughSchema,
        },
        async ({ flowId, name, description }) => {
            try {
                const result = await client.upsertFlow(flowId, filterDefined({ name, description }));
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'flow_publish',
        {
            title: 'Publish Flow',
            description:
                'Publish a flow publicly ("open as public") so anyone can view and run it, or unpublish it. ' +
                'Toggles the isPublic flag without touching nodes or edges. ' +
                'Pass isPublic=false to make the flow private again.',
            inputSchema: z.object({
                flowId,
                isPublic: z.optional(z.boolean()).describe('true to publish (default), false to make private'),
            }),
            outputSchema: PassthroughSchema,
        },
        async ({ flowId, isPublic }) => {
            try {
                const makePublic = isPublic ?? true;
                const result = await client.upsertFlow(flowId, { isPublic: makePublic });
                return toolResult({ flowId, url: urlFor(flowId), isPublic: makePublic, flow: result });
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'flow_save',
        {
            title: 'Save Flow',
            description:
                'DANGEROUS: Full replace of ALL nodes and edges in an existing flow. Node IDs may be reassigned. ' +
                'Edges are kept intact: reference nodes by array index (e.g., "0" for the first node) and they are ' +
                'auto-resolved to the saved node IDs. Only use for complete flow rebuilds. For modifications, use ' +
                'node_update (change properties), node_delete (remove nodes), or flow_create (new flow) instead.',
            inputSchema: z.object({
                flowId,
                name: z.optional(z.string()),
                description: z.optional(z.string()),
                nodes: z.array(NodeDataSchema).describe('Full node list (replaces ALL existing nodes)'),
                edges: z
                    .array(EdgeDataSchema)
                    .describe(
                        'Full edge list (replaces ALL existing edges). Use array index as node ID (e.g., "0") — ' +
                            'resolved to the saved node IDs internally.',
                    ),
            }),
            outputSchema: PassthroughSchema,
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async ({ flowId, name, description, nodes, edges }) => {
            try {
                // SaveFlowBody is { nodes, edges } only — the web app sets name/description via the
                // metadata upsert endpoint, NOT the save body. Save the graph first (no edges so the
                // backend assigns/returns the real node IDs), then resolve edges, then upsert metadata.
                const saved = await client.saveFlow(flowId, { nodes, edges: [] });

                let result = saved;
                if (edges.length && saved.nodes?.length) {
                    // The saved nodes come back in input order, so map each input node — by its array
                    // index AND its pre-save ID — to the ID the backend actually assigned. Edges may
                    // reference either form; both must land on a node that exists after the save, or
                    // the backend stores them dangling and they vanish from the canvas.
                    const realNodes = saved.nodes;
                    const idMap = new Map<string, string>();
                    nodes.forEach((n, i) => {
                        const savedId = realNodes[i]?.id;
                        if (!savedId) return;
                        idMap.set(String(i), savedId);
                        if (n.id) idMap.set(n.id, savedId);
                    });
                    const remap = (ref: string) => idMap.get(ref) ?? ref;
                    const resolvedEdges = edges.map(e => ({
                        sourceNodeId: remap(e.sourceNodeId),
                        sourcePortId: e.sourcePortId,
                        targetNodeId: remap(e.targetNodeId),
                        targetPortId: e.targetPortId,
                    }));
                    result = await client.saveFlow(flowId, { nodes: realNodes, edges: resolvedEdges });
                }

                if (name !== undefined || description !== undefined) {
                    result = await client.upsertFlow(flowId, filterDefined({ name, description }));
                }

                return toolResult(withUrl(result));
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'flow_clone',
        {
            title: 'Clone Flow',
            description:
                'Clone an existing flow into a new flow. Copies all nodes, edges, and config. ' +
                'Use to duplicate a flow as a starting point for modifications.',
            inputSchema: z.object({
                flowId,
                name: z.optional(z.string()).describe('Name for the cloned flow (default: original name + " (Copy)")'),
            }),
            outputSchema: PassthroughSchema,
        },
        async ({ flowId, name }) => {
            try {
                const source = await client.loadFlow(flowId);
                const nodes = stripNodeRuntime(source.nodes ?? []);
                const cloneName = name ?? `${source.name ?? 'Flow'} (Copy)`;

                // Save the graph with the bare { nodes, edges } body; set name/description via the
                // metadata upsert afterward (SaveFlowBody carries no name — same as the web app).
                const created = await client.saveFlow('0', { nodes, edges: [] });

                let result = created;
                const sourceEdges = source.edges ?? [];
                if (sourceEdges.length && created.nodes?.length) {
                    const indexEdges = remapEdgesToIndices(sourceEdges, source.nodes ?? []);
                    const resolvedEdges = indexEdges.map(e => ({
                        sourceNodeId: resolveNodeId(e.sourceNodeId, created.nodes!),
                        sourcePortId: e.sourcePortId,
                        targetNodeId: resolveNodeId(e.targetNodeId, created.nodes!),
                        targetPortId: e.targetPortId,
                    }));
                    result = await client.saveFlow(created.id, { nodes: created.nodes!, edges: resolvedEdges });
                }

                result = await client.upsertFlow(
                    created.id,
                    filterDefined({ name: cloneName, description: source.description }),
                );
                return toolResult(withUrl(result));
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'flow_export',
        {
            title: 'Export Flow',
            description:
                'Export flow as clean JSON that can be used with flow_create to recreate it. ' +
                'Strips runtime fields (status, errors). Use for backup, sharing, or git storage.',
            inputSchema: z.object({ flowId }),
            outputSchema: FlowExportOutputSchema,
            annotations: { readOnlyHint: true },
        },
        async ({ flowId }) => {
            try {
                const flow = await client.loadFlow(flowId);
                return toolResult({
                    name: flow.name,
                    description: flow.description,
                    nodes: stripNodeRuntime(flow.nodes ?? []),
                    edges: remapEdgesToIndices(flow.edges ?? [], flow.nodes ?? []),
                });
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'flow_run_from',
        {
            title: 'Run Flow From Node',
            description:
                'Execute a flow starting from a specific node with downstream propagation. ' +
                'Useful for retrying from a failed node without re-running the entire flow.',
            inputSchema: z.object({
                flowId,
                startNodeId: z.string().describe('Node ID to start execution from'),
                timeout: z.optional(z.number()).describe('Max wait time in ms (default: 60000)'),
            }),
            outputSchema: FlowRunOutputSchema,
        },
        async ({ flowId, startNodeId, timeout }, extra) => {
            try {
                mcpLog(server, 'info', `Starting flow execution from node ${startNodeId}: ${flowId}`);

                const flow = await client.loadFlow(flowId);
                const edges = flow.edges ?? [];
                const allNodeIds = (flow.nodes ?? []).filter(n => !n.disabled && n.id).map(n => n.id!);
                const downstreamIds = getDownstreamNodeIds(startNodeId, edges);
                const expectedNodeIds = [startNodeId, ...downstreamIds].filter(id => allNodeIds.includes(id));

                if (!isWsConfigured(apiConfig)) {
                    const result = await client.runNode(startNodeId, { propagate: true });
                    return toolResult(result);
                }

                const startTime = Date.now();
                const { nodeStates, timedOut, eventLog } = await executeWithWs(apiConfig, client, {
                    flowId,
                    expectedNodeIds,
                    channelId: flow.channelId,
                    timeout: timeout ?? 60_000,
                    onProgress: makeProgressHandler(extra),
                    triggerRun: async connectionId => {
                        await client.runNode(startNodeId, {
                            propagate: true,
                            async: true,
                            connection: connectionId,
                        });
                    },
                });

                const duration = Date.now() - startTime;
                mcpLog(
                    server,
                    timedOut ? 'warning' : 'info',
                    `Flow ${flowId} ${timedOut ? 'timed out' : 'completed'} in ${duration}ms`,
                );

                return buildRunResult({
                    client,
                    webBaseUrl: apiConfig.FLOW_WEB_URL,
                    flowId,
                    expectedNodeIds,
                    nodeStates,
                    timedOut,
                    startTime,
                    eventLog,
                    timeout,
                    startNodeId,
                });
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'flow_run',
        {
            title: 'Run Flow',
            description:
                'Execute entire flow. Triggers async execution and monitors via WebSocket until all nodes complete. ' +
                'Falls back to sync execution if WebSocket is not configured. Use flow_load after for full details.',
            inputSchema: z.object({
                flowId,
                config: z.optional(z.record(z.string(), z.string())).describe('Config overrides for the run'),
                timeout: z.optional(z.number()).describe('Max wait time in ms (default: 60000)'),
            }),
            outputSchema: FlowRunOutputSchema,
        },
        async ({ flowId, config: runConfig, timeout }, extra) => {
            try {
                mcpLog(server, 'info', `Starting flow execution: ${flowId}`);

                const body = runConfig ? { config: runConfig } : undefined;

                if (!isWsConfigured(apiConfig)) {
                    const result = await client.runFlow(flowId, body);
                    return toolResult(result);
                }

                const startTime = Date.now();

                const flow = await client.loadFlow(flowId);
                const allNodeIds = (flow.nodes ?? []).filter(n => !n.disabled && n.id).map(n => n.id!);

                // Pick the run's seed nodes the way the web app's "Run All" does: blocks with
                // stereo === 'input' whose autoExecution isn't disabled. Resolve stereo from the block
                // cache (keyed by processType or block id). Fall back to "no inbound edge" when stereo
                // can't be resolved, so unusual flows still run.
                const blocks = await client.listBlocks();
                const stereoOf = new Map<string, string>();
                for (const b of blocks.list ?? []) {
                    if (!b.stereo) continue;
                    if (b.processType) stereoOf.set(b.processType, b.stereo);
                    if (b.id) stereoOf.set(b.id, b.stereo);
                }
                const inputNodeIds = (flow.nodes ?? [])
                    .filter(
                        n =>
                            n.id && !n.disabled && n.autoExecutionEnabled !== false && stereoOf.get(n.type) === 'input',
                    )
                    .map(n => n.id!);
                const targetNodeIds = new Set((flow.edges ?? []).map(e => e.targetNodeId));
                const startNodeIds =
                    inputNodeIds.length > 0 ? inputNodeIds : allNodeIds.filter(id => !targetNodeIds.has(id));

                const { nodeStates, timedOut, eventLog } = await executeWithWs(apiConfig, client, {
                    flowId,
                    expectedNodeIds: allNodeIds,
                    channelId: flow.channelId,
                    timeout: timeout ?? 60_000,
                    onProgress: makeProgressHandler(extra),
                    triggerRun: async connectionId => {
                        // Match the web app exactly: ONE POST /flows/:id/run with all input node IDs so the
                        // backend orchestrates a single cascade. Triggering each start node separately (N
                        // parallel runNode+propagate) overlaps cascades and re-runs downstream nodes — extra
                        // runIds and duplicate (billable) AI calls. See WorkflowCanvas.tsx runFlow().
                        const runBody = runConfig
                            ? { nodeIds: startNodeIds, config: runConfig }
                            : { nodeIds: startNodeIds };
                        await client.runFlow(flowId, runBody, { async: true, connection: connectionId });
                    },
                });

                const duration = Date.now() - startTime;
                mcpLog(
                    server,
                    timedOut ? 'warning' : 'info',
                    `Flow ${flowId} ${timedOut ? 'timed out' : 'completed'} in ${duration}ms`,
                );

                return buildRunResult({
                    client,
                    webBaseUrl: apiConfig.FLOW_WEB_URL,
                    flowId,
                    expectedNodeIds: allNodeIds,
                    nodeStates,
                    timedOut,
                    startTime,
                    eventLog,
                    timeout,
                });
            } catch (e) {
                return toolError(e);
            }
        },
    );
};

/** BFS to find all downstream node IDs from a start node */
export const getDownstreamNodeIds = (startId: string, edges: EdgeData[]): string[] => {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
        const targets = adj.get(e.sourceNodeId);
        if (targets) targets.push(e.targetNodeId);
        else adj.set(e.sourceNodeId, [e.targetNodeId]);
    }

    const result: string[] = [];
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        if (current !== startId) result.push(current);
        for (const target of adj.get(current) ?? []) {
            if (!visited.has(target)) queue.push(target);
        }
    }
    return result;
};

export const resolveNodeId = (ref: string, nodes: Array<{ id?: string }>): string => {
    const index = parseInt(ref, 10);
    if (!isNaN(index) && index >= 0 && index < nodes.length && String(index) === ref) {
        return nodes[index]?.id ?? ref;
    }
    return ref;
};
