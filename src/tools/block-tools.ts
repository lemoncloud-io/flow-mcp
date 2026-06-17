import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FlowApiError } from '../api-client';
import type { FlowApiClient } from '../api-client';
import { toolError, toolResult } from './helpers';
import { completableBlockType, completableStereo } from './completions';
import { PassthroughSchema, BlockListOutputSchema } from './schemas';
import type { BlockView } from '../types';

export const registerBlockTools = (server: McpServer, client: FlowApiClient) => {
    const blockType = completableBlockType(client);

    server.registerTool(
        'block_get',
        {
            title: 'Get Block',
            description:
                'Get block definition by ID or name (e.g. "input-text", "text-transform"). ' +
                'Returns full port specs and config schema. Use block_list first to discover available blocks.',
            inputSchema: z.object({
                blockId: blockType,
            }),
            outputSchema: PassthroughSchema,
            annotations: { readOnlyHint: true },
        },
        async ({ blockId }) => {
            try {
                return toolResult(summarizeBlock(await resolveBlock(client, blockId)));
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'block_list',
        {
            title: 'List Blocks',
            description:
                'List all available block definitions with ports and config schema. ' +
                'Call this BEFORE creating flows to know what block types exist, their inputs/outputs, and configuration options.',
            inputSchema: z.object({
                stereo: z.optional(completableStereo),
            }),
            outputSchema: BlockListOutputSchema,
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
                return toolResult({ total: summary.length, blocks: summary });
            } catch (e) {
                return toolError(e);
            }
        },
    );
};

/** Fetch a block by id; resolve processType/name/label via the catalog. */
const resolveBlock = async (client: FlowApiClient, blockId: string): Promise<BlockView> => {
    // Numeric → real block ID; fetch directly. Non-numeric → processType/name/label, resolve via catalog
    // (avoids a speculative GET /blocks/:id that 404s and spams backend error-reporting).
    if (/^\d+$/.test(blockId)) return await client.getBlock(blockId);

    const { list } = await client.listBlocks();
    const match = list.find(
        b => b.id === blockId || b.processType === blockId || b.name === blockId || b.label === blockId,
    );
    if (!match) throw new FlowApiError('not_found', `Block not found: ${blockId}`);
    return match;
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
