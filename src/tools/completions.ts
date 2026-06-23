import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import * as z from 'zod/v4';
import type { FlowApiClient } from '../api-client';

/** In-memory cache for flow list completions (30s TTL) */
let flowCache: { list: Array<{ id?: string; name?: string }>; at: number } | null = null;
const FLOW_CACHE_TTL = 30_000;

/** Completable flowId field — fetches recent flows for autocomplete */
export const completableFlowId = (client: FlowApiClient) =>
    completable(z.string().describe('Flow ID'), async value => {
        const now = Date.now();
        if (!flowCache || now - flowCache.at > FLOW_CACHE_TTL) {
            const result = await client.listFlows({ page: 0 });
            flowCache = { list: result.list, at: now };
        }
        const lower = value.toLowerCase();
        return flowCache.list
            .filter(f => f.id?.startsWith(value) || f.name?.toLowerCase().includes(lower))
            .map(f => f.id!)
            .filter(Boolean);
    });

/** Completable block type — fetches block catalog for autocomplete (uses existing 5min cache) */
export const completableBlockType = (client: FlowApiClient) =>
    completable(
        z.string().describe('Block ID or process type (e.g., "input-text"). Get from block_list.'),
        async value => {
            const result = await client.listBlocks();
            const lower = value.toLowerCase();
            return result.list
                .map(b => b.processType ?? b.name)
                .filter((t): t is string => !!t && t.toLowerCase().includes(lower));
        },
    );

/** Completable stereo filter */
export const completableStereo = completable(z.string().describe('Block category filter'), value =>
    ['input', 'process', 'output'].filter(s => s.startsWith(value)),
);

/** In-memory cache for product list completions (60s TTL) */
let productCache: { list: Array<{ id: string; name?: string }>; at: number } | null = null;
const PRODUCT_CACHE_TTL = 60_000;

/** Completable productId — fetches credit packs for autocomplete */
export const completableProductId = (client: FlowApiClient) =>
    completable(z.string().describe('Credit pack/product ID. Get from credit_packs.'), async value => {
        const now = Date.now();
        if (!productCache || now - productCache.at > PRODUCT_CACHE_TTL) {
            const result = await client.listProducts();
            productCache = { list: result.list ?? [], at: now };
        }
        const lower = value.toLowerCase();
        return productCache.list
            .filter(p => p.id?.startsWith(value) || p.name?.toLowerCase().includes(lower))
            .map(p => p.id)
            .filter(Boolean);
    });

/** Reset flow cache (for testing) */
export const resetFlowCache = () => {
    flowCache = null;
};
