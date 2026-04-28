import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowApiClient } from '../api-client';
import type { RunView } from '../types';
import { toolError, toolResult } from './helpers';
import { PassthroughSchema, RunListOutputSchema } from './schemas';

const summarizeRun = (r: RunView): Record<string, unknown> => ({
    id: r.id,
    flowId: r.flowId,
    nodeId: r.nodeId,
    model: r.model,
    usage: r.usage$,
    executedAt: r.executedAt,
    finishedAt: r.finishedAt,
    elapsedMs: r.elapsedMs,
    childNo: r.childNo,
});

export const registerRunTools = (server: McpServer, client: FlowApiClient) => {
    server.registerTool(
        'run_list',
        {
            title: 'List Runs',
            description:
                'List recent execution runs with token usage and timing. ' +
                'Use to review execution history, check costs, and debug past runs.',
            inputSchema: z.object({
                limit: z.optional(z.number().int().min(1).max(100)).describe('Max results (default: 10)'),
                offset: z.optional(z.number().int().min(0)).describe('Pagination offset'),
            }),
            outputSchema: RunListOutputSchema,
            annotations: { readOnlyHint: true },
        },
        async ({ limit, offset }) => {
            try {
                const result = await client.listRuns({ limit, offset });
                const runs = result.list.map(summarizeRun);
                return toolResult({ total: result.total, limit: result.limit, offset: result.offset, runs });
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'run_get',
        {
            title: 'Get Run',
            description:
                'Get execution run details including token usage, model, and timing. ' +
                'Use run_list first to find run IDs.',
            inputSchema: z.object({
                runId: z.string().describe('Run ID'),
            }),
            outputSchema: PassthroughSchema,
            annotations: { readOnlyHint: true },
        },
        async ({ runId }) => {
            try {
                const result = await client.getRun(runId);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );
};
