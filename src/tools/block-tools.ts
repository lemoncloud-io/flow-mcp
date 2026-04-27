import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowApiClient } from '../api-client';
import { toolError, toolJson } from './helpers';
import type { BlockView } from '../types';

export const registerBlockTools = (server: McpServer, client: FlowApiClient) => {
    server.registerTool(
        'block_list',
        {
            title: 'List Blocks',
            description:
                'List all available block definitions with ports and config schema. ' +
                'Call this BEFORE creating flows to know what block types exist, their inputs/outputs, and configuration options.',
            inputSchema: z.object({
                stereo: z.optional(z.enum(['input', 'process', 'output'])).describe('Filter by block category'),
            }),
            annotations: { readOnlyHint: true },
        },
        async ({ stereo }) => {
            try {
                const result = await client.listBlocks();
                let blocks = result.list.filter(b => !b.isHidden);

                if (stereo) {
                    blocks = blocks.filter(b => b.stereo === stereo);
                }

                const summary = blocks.map(summarizeBlock);
                return toolJson({ total: summary.length, blocks: summary });
            } catch (e) {
                return toolError(e);
            }
        },
    );
};

export const summarizeBlock = (b: BlockView) => ({
    id: b.id,
    type: b.processType ?? b.$definition?.type,
    label: b.label ?? b.name,
    stereo: b.stereo,
    description: b.description ?? b.$definition?.description,
    isRunnable: b.isRunnable,
    isFrontend: b.isFrontend,
    inputs: b.$definition?.inputs ?? b.input$$ ?? [],
    outputs: b.$definition?.outputs ?? b.output$$ ?? [],
    configSchema: b.$definition?.configSchema ?? b.config$$ ?? [],
});
