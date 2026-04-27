import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowApiClient } from '../api-client';
import type { FlowApiConfig } from '../config';
import { executeWithWs, isWsConfigured, checkNodeStatesViaApi } from '../ws-client';
import { TERMINAL_STATES } from '../types';
import { toolError, toolJson } from './helpers';

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
    'flow_save',
    {
      title: 'Save Flow',
      description:
        'Save flow (full replace of nodes + edges). Always use flow_load first to get current state. ' +
        'WARNING: This overwrites ALL existing nodes and edges.',
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
    'flow_delete',
    {
      title: 'Delete Flow',
      description: 'Delete a flow permanently. This cannot be undone.',
      inputSchema: z.object({
        flowId: z.string().describe('Flow ID to delete'),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ flowId }) => {
      try {
        await client.deleteFlow(flowId);
        return toolJson({ deleted: true, flowId });
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

        // Load node list for expectedNodeIds
        const flow = await client.loadFlow(flowId);
        const expectedNodeIds = (flow.nodes ?? [])
          .filter((n) => !n.disabled && n.id)
          .map((n) => n.id!);

        const { nodeStates, timedOut } = await executeWithWs(apiConfig, client, {
          flowId,
          expectedNodeIds,
          timeout: timeout ?? 60_000,
          triggerRun: () => client.runFlow(flowId, body, { async: true }).then(() => {}),
        });

        const finalFlow = await client.loadFlow(flowId);
        const nodes = (finalFlow.nodes ?? []).map((n) => ({
          id: n.id ?? '',
          status: n.status ?? nodeStates.get(n.id ?? '') ?? 'UNKNOWN',
          error: n.errorMessage ?? n.error,
        }));

        const hasError = nodes.some((n) => n.status === 'ERROR');
        const status = timedOut ? 'timeout' : hasError ? 'error' : 'completed';

        return toolJson({
          flowId,
          status,
          nodes,
          duration: Date.now() - startTime,
          ...(timedOut && {
            message: `Timed out after ${timeout ?? 60_000}ms. ${nodes.filter((n) => TERMINAL_STATES.has(n.status)).length}/${expectedNodeIds.length} nodes completed.`,
          }),
        });
      } catch (e) {
        return toolError(e);
      }
    },
  );
};

const resolveNodeId = (
  ref: string,
  nodes: Array<{ id?: string }>,
): string => {
  const index = parseInt(ref, 10);
  if (!isNaN(index) && index >= 0 && index < nodes.length && String(index) === ref) {
    return nodes[index]?.id ?? ref;
  }
  return ref;
};
