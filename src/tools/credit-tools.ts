import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowApiClient } from '../api-client';
import type { ProductView, TransactionView, WalletView } from '../types';
import { toolError, toolResult } from './helpers';
import { completableProductId } from './completions';
import {
    PassthroughSchema,
    CreditBalanceOutputSchema,
    CreditPacksOutputSchema,
    CreditHistoryOutputSchema,
} from './schemas';

const walletTotal = (w: WalletView): number => w.total ?? (w.available ?? 0) + (w.held ?? 0);

const summarizePack = (p: ProductView): Record<string, unknown> => ({
    id: p.id,
    name: p.name,
    credits: p.totalCredit ?? (p.creditAmount ?? 0) + (p.bonusAmount ?? 0),
    baseCredits: p.creditAmount,
    bonusCredits: p.bonusAmount,
    priceUsd: p.stripeAmount !== undefined ? p.stripeAmount / 100 : undefined,
    currency: p.currency ?? 'USD',
    expiresInDays: p.expiresInDays,
});

const summarizeTransaction = (t: TransactionView): Record<string, unknown> => ({
    id: t.id,
    stereo: t.stereo,
    reason: t.reason,
    name: t.name,
    amount: t.amount,
    creditChange: t.creditChange,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
});

export const registerCreditTools = (server: McpServer, client: FlowApiClient) => {
    const productId = completableProductId(client);

    server.registerTool(
        'credit_balance',
        {
            title: 'Credit Balance',
            description:
                'Check the current credit balance (wallet). Returns total, available, and held credits. ' +
                'New wallets receive a one-time signup bonus. Credits are the unit consumed by AI block execution.',
            inputSchema: z.object({}),
            outputSchema: CreditBalanceOutputSchema,
            annotations: { readOnlyHint: true },
        },
        async () => {
            try {
                const wallet = await client.getWalletBalance();
                return toolResult({
                    total: walletTotal(wallet),
                    available: wallet.available,
                    held: wallet.held,
                    wallet,
                });
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'credit_packs',
        {
            title: 'List Credit Packs',
            description:
                'List purchasable credit packs (products) with their credit amount and USD price. ' +
                'Use before credit_purchase to pick a pack ID.',
            inputSchema: z.object({}),
            outputSchema: CreditPacksOutputSchema,
            annotations: { readOnlyHint: true },
        },
        async () => {
            try {
                const result = await client.listProducts();
                const packs = (result.list ?? []).map(summarizePack);
                return toolResult({ total: result.total ?? packs.length, packs });
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'credit_purchase',
        {
            title: 'Purchase Credits',
            description:
                'Charge credits using the card on file (headless — no browser needed). ' +
                'Use credit_packs first to choose a productId. ' +
                'Requires a default payment method enrolled at https://billing.eureka.codes (returns a payment error if none). ' +
                'Idempotent per requestId — reusing the same requestId will not double-charge.',
            inputSchema: z.object({
                productId,
                requestId: z
                    .optional(z.string())
                    .describe('Idempotency key (UUID). Auto-generated if omitted; reuse to retry safely.'),
            }),
            outputSchema: PassthroughSchema,
            annotations: { idempotentHint: true },
        },
        async ({ productId, requestId }) => {
            try {
                const idem = requestId ?? randomUUID();
                const transaction = await client.purchaseCredits(productId, idem);
                // Best-effort balance refresh — purchase already succeeded.
                const balance = await client
                    .getWalletBalance()
                    .then(walletTotal)
                    .catch(() => undefined);
                return toolResult({ productId, requestId: idem, transaction, balance });
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'credit_history',
        {
            title: 'Credit History',
            description:
                'List credit ledger transactions (purchases, usage, bonuses, cancellations). ' +
                'Use to review credit spend and top-ups. creditChange is signed: positive = gained, negative = spent.',
            inputSchema: z.object({
                stereo: z
                    .optional(z.enum(['gain', 'use', 'purchase', 'cancel']))
                    .describe('Filter by transaction type'),
                limit: z.optional(z.number().int().min(1).max(100)).describe('Max results (default: 24)'),
                page: z.optional(z.number().int().min(0)).describe('0-based page number'),
            }),
            outputSchema: CreditHistoryOutputSchema,
            annotations: { readOnlyHint: true },
        },
        async ({ stereo, limit, page }) => {
            try {
                const result = await client.listTransactions({ stereo, limit, page });
                const transactions = (result.list ?? []).map(summarizeTransaction);
                return toolResult({
                    total: result.total ?? transactions.length,
                    page,
                    limit: result.limit,
                    transactions,
                });
            } catch (e) {
                return toolError(e);
            }
        },
    );
};
