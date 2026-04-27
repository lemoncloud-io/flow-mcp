import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowApiClient } from '../api-client';
import type { FlowApiConfig } from '../config';
import { executeWithWs, isWsConfigured } from '../ws-client';
import { toolError, toolJson } from './helpers';

export const registerNodeTools = (server: McpServer, client: FlowApiClient, apiConfig: FlowApiConfig) => {
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
        propagate: z
          .optional(z.boolean())
          .describe('Propagate execution to downstream nodes (default: false)'),
        config: z
          .optional(z.record(z.string(), z.string()))
          .describe('Config overrides for this execution'),
        timeout: z
          .optional(z.number())
          .describe('Max wait time in ms (default: 30000)'),
      }),
    },
    async ({ nodeId, flowId, propagate, config: runConfig, timeout }) => {
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
          triggerRun: (connectionId) => client.runNode(nodeId, { ...opts, async: true, connection: connectionId }).then(() => {}),
        });

        const finalFlow = await client.loadFlow(flowId);
        const node = (finalFlow.nodes ?? []).find((n) => n.id === nodeId);
        // Prefer WS-reported state (more up-to-date than API which may lag)
        const status = nodeStates.get(nodeId) ?? node?.status ?? 'UNKNOWN';

        const result: Record<string, unknown> = {
          nodeId,
          flowId,
          status,
          duration: Date.now() - startTime,
        };

        if (node?.error || node?.errorMessage) {
          result.error = node.errorMessage ?? node.error;
        }

        if (timedOut) {
          result.message = `Timed out after ${timeout ?? 30_000}ms. Node status: ${status}`;
        }

        result.eventLog = eventLog;
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
    async ({ nodeId, flowId, customLabel, description, config: nodeConfig, output, position, disabled, blockId, errorMessage, autoExecutionEnabled }) => {
      try {
        const body: Record<string, unknown> = {};
        if (customLabel !== undefined) body.customLabel = customLabel;
        if (description !== undefined) body.description = description;
        if (nodeConfig !== undefined) body.config = nodeConfig;
        if (output !== undefined) body.output = output;
        if (position !== undefined) body.position = position;
        if (disabled !== undefined) body.disabled = disabled;
        if (blockId !== undefined) body.blockId = blockId;
        if (errorMessage !== undefined) body.errorMessage = errorMessage;
        if (autoExecutionEnabled !== undefined) body.autoExecutionEnabled = autoExecutionEnabled;

        const result = await client.upsertNode(nodeId, flowId, body);
        return toolJson(result);
      } catch (e) {
        return toolError(e);
      }
    },
  );
};
