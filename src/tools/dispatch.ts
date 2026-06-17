import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowApiClient } from '../api-client';
import type { FlowApiConfig } from '../config';
import { registerFlowTools } from './flow-tools';
import { registerNodeTools } from './node-tools';
import { registerBlockTools } from './block-tools';
import { registerRunTools } from './run-tools';
import { registerCreditTools } from './credit-tools';
import { toolError } from './helpers';
import { PassthroughSchema } from './schemas';

/** Flow domain, read-only — list/load/export flows, graph, inspect nodes/ports/blocks/runs. */
export const FLOW_READ_ACTIONS = [
    'profile_get',
    'flow_list',
    'flow_load',
    'flow_graph',
    'flow_export',
    'node_get',
    'node_get_port',
    'block_get',
    'block_list',
    'run_list',
    'run_get',
] as const;

/** Flow domain, mutating/executing — create/update/publish/save/clone/run flows, node + edge edits. */
export const FLOW_DO_ACTIONS = [
    'flow_create',
    'flow_update',
    'flow_publish',
    'flow_save',
    'flow_clone',
    'flow_run',
    'flow_run_from',
    'node_create',
    'node_run',
    'node_update',
    'node_delete',
    'edge_create',
    'edge_delete',
] as const;

/** Billing domain, read-only — balance, packs, history. */
export const CREDIT_READ_ACTIONS = ['credit_balance', 'credit_packs', 'credit_history'] as const;

/** Billing domain, mutating — purchase (charges the card on file). */
export const CREDIT_DO_ACTIONS = ['credit_purchase'] as const;

type ToolMeta = { title?: string; description?: string; inputSchema?: z.ZodType };
type CapturedHandler = (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
type Captured = Record<string, { meta: ToolMeta; handler: CapturedHandler }>;

/** Register the granular tools against a fake server to capture their handlers + schemas. */
const captureHandlers = (server: McpServer, client: FlowApiClient, config: FlowApiConfig): Captured => {
    const captured: Captured = {};
    const fake = {
        registerTool: (name: string, meta: ToolMeta, handler: CapturedHandler) => {
            captured[name] = { meta, handler };
        },
        // Handlers log via mcpLog(server, ...) — delegate to the real server so client logging still works.
        sendLoggingMessage: server.sendLoggingMessage.bind(server),
    } as unknown as McpServer;

    registerFlowTools(fake, client, config);
    registerNodeTools(fake, client, config);
    registerBlockTools(fake, client);
    registerRunTools(fake, client);
    registerCreditTools(fake, client);
    return captured;
};

/** Build a "action(field1, field2)" list for the tool description. */
const describeActions = (actions: readonly string[], captured: Captured): string =>
    actions
        .map(name => {
            const schema = captured[name]?.meta.inputSchema as { shape?: Record<string, unknown> } | undefined;
            const fields = schema?.shape ? Object.keys(schema.shape) : [];
            return `• ${name}(${fields.join(', ') || 'no params'})`;
        })
        .join('\n');

/** Route an action through its captured handler, validating params against the original schema. */
const makeDispatcher =
    (captured: Captured, allowed: readonly string[]) =>
    async (args: { action: string; params?: Record<string, unknown> }, extra: unknown) => {
        const { action, params } = args;
        if (!allowed.includes(action)) {
            return toolError(new Error(`Unknown action "${action}". Allowed: ${allowed.join(', ')}`));
        }
        const def = captured[action];
        const schema = def.meta.inputSchema;
        const parsed = schema ? z.safeParse(schema, params ?? {}) : { success: true as const, data: params ?? {} };
        if (!parsed.success) {
            return toolError(new Error(`Invalid params for "${action}": ${z.prettifyError(parsed.error)}`));
        }
        return def.handler(parsed.data as Record<string, unknown>, extra);
    };

type DispatchSpec = {
    name: string;
    title: string;
    description: string;
    paramHint: string;
    readOnly: boolean;
    actions: readonly string[];
};

const registerDispatchTool = (server: McpServer, captured: Captured, spec: DispatchSpec) => {
    server.registerTool(
        spec.name,
        {
            title: spec.title,
            description: `${spec.description}\n${describeActions(spec.actions, captured)}`,
            annotations: spec.readOnly ? { readOnlyHint: true } : undefined,
            inputSchema: z.object({
                action: z.enum(spec.actions as unknown as [string, ...string[]]).describe('Which operation to run'),
                params: z.optional(z.object({}).passthrough()).describe(spec.paramHint),
            }),
            outputSchema: PassthroughSchema,
        },
        makeDispatcher(captured, spec.actions) as never,
    );
};

/**
 * Register four domain × access tools instead of 28 granular ones:
 * - flow_read   (read-only): list/load/export flows, graph, inspect nodes/ports/blocks/runs
 * - flow_do     (writes/runs): create/update/publish/save/clone/run flows, node + edge edits
 * - credit_read (read-only): balance, packs, history
 * - credit_do   (writes): purchase
 * Read tools carry readOnlyHint so clients can treat them as safe. Each takes { action, params }.
 */
export const registerDispatchTools = (server: McpServer, client: FlowApiClient, config: FlowApiConfig) => {
    const captured = captureHandlers(server, client, config);

    registerDispatchTool(server, captured, {
        name: 'flow_read',
        title: 'Eureka Flow — Read',
        description:
            'Eureka Flow, read-only — list/load/export flows, view the graph, inspect nodes, ports, ' +
            'blocks, and run history. Never mutates. Call with { action, params }. Actions:',
        paramHint: 'Parameters for the action (e.g. { flowId } for flow_load). Omit if none.',
        readOnly: true,
        actions: FLOW_READ_ACTIONS,
    });

    registerDispatchTool(server, captured, {
        name: 'flow_do',
        title: 'Eureka Flow — Edit & Run',
        description:
            'Eureka Flow, changes & execution — create/update/publish/save/clone flows, run flows, ' +
            'add/run/update/delete nodes, connect/remove edges. Call with { action, params }. ' +
            '⚠️ Mutates and executes (node_delete removes nodes, flow_run runs the flow). Actions:',
        paramHint: 'Parameters for the action (e.g. { flowId, name } for flow_create). Omit if none.',
        readOnly: false,
        actions: FLOW_DO_ACTIONS,
    });

    registerDispatchTool(server, captured, {
        name: 'credit_read',
        title: 'Eureka Credits — Read',
        description:
            'Eureka credits, read-only — check balance, list purchasable packs, review history. ' +
            'Never charges. Call with { action, params }. Actions:',
        paramHint: 'Parameters for the action (most take none). Omit if none.',
        readOnly: true,
        actions: CREDIT_READ_ACTIONS,
    });

    registerDispatchTool(server, captured, {
        name: 'credit_do',
        title: 'Eureka Credits — Purchase',
        description:
            'Eureka credits, purchase — top up credits. Call with { action, params }. ' +
            '⚠️ credit_purchase charges the card on file at billing.eureka.codes. Actions:',
        paramHint: 'Parameters for the action (e.g. { productId } for credit_purchase).',
        readOnly: false,
        actions: CREDIT_DO_ACTIONS,
    });
};
