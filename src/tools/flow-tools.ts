import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowApiClient } from '../api-client';
import type { FlowApiConfig } from '../config';
import { executeWithWs, isWsConfigured, checkNodeStatesViaApi } from '../ws-client';
import { TERMINAL_STATES } from '../types';
import { filterDefined, toolError, toolJson } from './helpers';

const NodeDataSchema = z.object({
  type: z.string().describe('Block process type (e.g., "input-text", "text-transform"). Get from block_list.'),
  position: z.object({ x: z.number(), y: z.number() }).describe('Canvas position'),
  config: z.optional(z.record(z.string(), z.string())).describe('Node config key-value pairs. Keys from block configSchema.'),
  customLabel: z.optional(z.string()),
});

const EdgeDataSchema = z.object({
  sourceNodeId: z.string().describe('Source node ID or array index (e.g., "0", "1") when creating.'),
  sourcePortId: z.string().describe('Source port ID (e.g., "out"). Get from block outputs.'),
  targetNodeId: z.string().describe('Target node ID or array index when creating.'),
  targetPortId: z.string().describe('Target port ID (e.g., "in"). Get from block inputs.'),
});

export const registerFlowTools = (server: McpServer, client: FlowApiClient, apiConfig: FlowApiConfig) => {
  server.registerTool(
    'flow_list',
    {
      title: 'List Flows',
      description:
        'List user\'s flows. Use this first to see available flows before loading or running them.',
      inputSchema: z.object({
        isPublic: z.optional(z.boolean()).describe('Filter public flows only'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ isPublic }) => {
      try {
        const result = await client.listFlows(isPublic !== undefined ? { isPublic } : undefined);
        const summary = result.list.map((f) => ({
          id: f.id,
          name: f.name,
          state: f.state,
          status: f.status,
          isPublic: f.isPublic,
          modifiedAt: f.modifiedAt,
        }));
        return toolJson({ total: result.total, flows: summary });
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
        'Load flow with full canvas state (nodes, edges, ports). Use to inspect a flow\'s structure before modifying.',
      inputSchema: z.object({
        flowId: z.string().describe('Flow ID to load'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ flowId }) => {
      try {
        const flow = await client.loadFlow(flowId);
        return toolJson(flow);
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
      inputSchema: z.object({
        flowId: z.string().describe('Flow ID to visualize'),
      }),
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

        // Mermaid
        const mermaid = [
          'graph LR',
          ...nodes.map((n) => {
            const label = (n.customLabel ?? n.type ?? n.id ?? '').replace(/"/g, "'");
            return `  ${n.id}["${icon(n.status)} ${label}"]`;
          }),
          ...edges.map((e) => `  ${e.sourceNodeId} --> ${e.targetNodeId}`),
        ].join('\n');

        // Compact summary
        const connectedIds = new Set([...edges.map((e) => e.sourceNodeId), ...edges.map((e) => e.targetNodeId)]);
        const orphans = nodes.filter((n) => !connectedIds.has(n.id!));
        const portValues = ports.filter((p) => p.data?.value).map((p) => `${p.id}: ${JSON.stringify(p.data!.value)}`);

        const summary = [
          `# ${flow.name ?? flowId}`,
          '',
          '```mermaid',
          mermaid,
          '```',
          '',
          `**Nodes:** ${nodes.map((n) => `${icon(n.status)}${n.customLabel ?? n.type}(${n.id})`).join(' → ')}`,
          portValues.length ? `**Data:** ${portValues.join(' | ')}` : '',
          orphans.length ? `**Orphans:** ${orphans.map((n) => `${n.id}(${n.customLabel ?? n.type})`).join(', ')}` : '',
          nodes.some((n) => n.error || n.errorMessage) ? `**Errors:** ${nodes.filter((n) => n.error || n.errorMessage).map((n) => `${n.id}: ${n.errorMessage ?? n.error}`).join(', ')}` : '',
        ].filter(Boolean).join('\n');

        return { content: [{ type: 'text' as const, text: summary }] };
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
        nodes: z
          .array(NodeDataSchema)
          .optional()
          .describe('Initial nodes.'),
        edges: z
          .array(EdgeDataSchema)
          .optional()
          .describe(
            'Connections between nodes. Use array index as node ID (e.g., "0" for first node) — resolved to real IDs internally.',
          ),
      }),
    },
    async ({ name, description, nodes, edges }) => {
      try {
        const created = await client.saveFlow('0', {
          name,
          description,
          nodes: nodes ?? [],
          edges: [],
        });

        if (!edges?.length || !created.nodes?.length) {
          return toolJson(created);
        }

        const realNodes = created.nodes;
        const resolvedEdges = edges.map((e) => ({
          sourceNodeId: resolveNodeId(e.sourceNodeId, realNodes),
          sourcePortId: e.sourcePortId,
          targetNodeId: resolveNodeId(e.targetNodeId, realNodes),
          targetPortId: e.targetPortId,
        }));

        const saved = await client.saveFlow(created.id, {
          name,
          description,
          nodes: realNodes,
          edges: resolvedEdges,
        });

        return toolJson(saved);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    'flow_update',
    {
      title: 'Update Flow',
      description: 'Update flow metadata (name, description) without touching nodes or edges. Safe to use anytime.',
      inputSchema: z.object({
        flowId: z.string().describe('Flow ID'),
        name: z.optional(z.string()).describe('New flow name'),
        description: z.optional(z.string()).describe('New flow description'),
      }),
    },
    async ({ flowId, name, description }) => {
      try {
        const result = await client.upsertFlow(flowId, filterDefined({ name, description }));
        return toolJson(result);
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
        'DANGEROUS: Full replace of ALL nodes and edges. Node IDs will be reassigned, breaking existing edges. ' +
        'Only use for complete flow rebuilds. For modifications, use node_update (change properties), ' +
        'node_delete (remove nodes), or flow_create (new flow) instead.',
      inputSchema: z.object({
        flowId: z.string().describe('Flow ID. Use flow_load first to get current state.'),
        name: z.optional(z.string()),
        description: z.optional(z.string()),
        nodes: z.array(NodeDataSchema).describe('Full node list (replaces ALL existing nodes)'),
        edges: z.array(EdgeDataSchema).describe('Full edge list (replaces ALL existing edges)'),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ flowId, name, description, nodes, edges }) => {
      try {
        const result = await client.saveFlow(flowId, { name, description, nodes, edges });
        return toolJson(result);
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
        flowId: z.string().describe('Flow ID to execute'),
        config: z.optional(z.record(z.string(), z.string())).describe('Config overrides for the run'),
        timeout: z.optional(z.number()).describe('Max wait time in ms (default: 60000)'),
      }),
    },
    async ({ flowId, config: runConfig, timeout }) => {
      try {
        const body = runConfig ? { config: runConfig } : undefined;

        if (!isWsConfigured(apiConfig)) {
          const result = await client.runFlow(flowId, body);
          return toolJson(result);
        }

        const startTime = Date.now();

        // Load flow to find start nodes (nodes with no incoming edges)
        const flow = await client.loadFlow(flowId);
        const allNodeIds = (flow.nodes ?? []).filter((n) => !n.disabled && n.id).map((n) => n.id!);
        const targetNodeIds = new Set((flow.edges ?? []).map((e) => e.targetNodeId));
        const startNodeIds = allNodeIds.filter((id) => !targetNodeIds.has(id));

        // Run each start node with propagate=true to trigger the full chain
        const { nodeStates, timedOut, eventLog } = await executeWithWs(apiConfig, client, {
          flowId,
          expectedNodeIds: allNodeIds,
          timeout: timeout ?? 60_000,
          triggerRun: async (connectionId) => {
            const runOpts = { propagate: true, async: true, connection: connectionId };
            await Promise.all(
              startNodeIds.map((nodeId) => client.runNode(nodeId, runOpts)),
            );
          },
        });

        // Build result from pre-run flow + WS states; only re-fetch if errors detected
        const hasError = [...nodeStates.values()].some((s) => s === 'ERROR');
        let nodes = allNodeIds.map((id) => ({
          id,
          status: nodeStates.get(id) ?? 'UNKNOWN',
          error: undefined as string | undefined,
        }));

        if (hasError || timedOut) {
          const finalFlow = await client.loadFlow(flowId);
          nodes = (finalFlow.nodes ?? []).map((n) => ({
            id: n.id ?? '',
            status: nodeStates.get(n.id ?? '') ?? n.status ?? 'UNKNOWN',
            error: n.errorMessage ?? n.error,
          }));
        }

        const status = timedOut ? 'timeout' : hasError ? 'error' : 'completed';

        return toolJson({
          flowId,
          status,
          nodes,
          duration: Date.now() - startTime,
          eventLog,
          ...(timedOut && {
            message: `Timed out after ${timeout ?? 60_000}ms. ${nodes.filter((n) => TERMINAL_STATES.has(n.status)).length}/${allNodeIds.length} nodes completed.`,
          }),
        });
      } catch (e) {
        return toolError(e);
      }
    },
  );
};

export const resolveNodeId = (
  ref: string,
  nodes: Array<{ id?: string }>,
): string => {
  const index = parseInt(ref, 10);
  if (!isNaN(index) && index >= 0 && index < nodes.length && String(index) === ref) {
    return nodes[index]?.id ?? ref;
  }
  return ref;
};
