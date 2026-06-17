import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerCreditTools } from '../../src/tools';
import { makeApiClient, makeWallet, makeProduct, makeTransaction, makeListResult, type MockApiClient } from '../helpers/factories';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

type ToolHandler = (...args: unknown[]) => Promise<unknown>;
const captureHandlers = (mockClient: MockApiClient) => {
  const handlers: Record<string, ToolHandler> = {};
  const mockServer = {
    registerTool: vi.fn((name: string, _meta: unknown, handler: ToolHandler) => {
      handlers[name] = handler;
    }),
    sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpServer;

  registerCreditTools(mockServer, mockClient as never);
  return handlers;
};

const parse = (result: unknown) => JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

describe('credit tool handlers', () => {
  let mockClient: MockApiClient;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    mockClient = makeApiClient();
    handlers = captureHandlers(mockClient);
  });

  describe('credit_balance', () => {
    it('should return total/available/held from wallet', async () => {
      mockClient.getWalletBalance.mockResolvedValue(makeWallet({ total: 1500, available: 1400, held: 100 }));

      const parsed = parse(await handlers.credit_balance({}));

      expect(parsed.total).toBe(1500);
      expect(parsed.available).toBe(1400);
      expect(parsed.held).toBe(100);
    });

    it('should derive total from available + held when total missing', async () => {
      mockClient.getWalletBalance.mockResolvedValue({ available: 300, held: 200 });

      const parsed = parse(await handlers.credit_balance({}));

      expect(parsed.total).toBe(500);
    });

    it('should return toolError on failure', async () => {
      mockClient.getWalletBalance.mockRejectedValue(new Error('wallet down'));

      const result = await handlers.credit_balance({});

      expect((result as { isError: boolean }).isError).toBe(true);
    });
  });

  describe('credit_packs', () => {
    it('should summarize packs with USD price and total credits', async () => {
      mockClient.listProducts.mockResolvedValue(makeListResult([makeProduct({ id: 'p-1', stripeAmount: 2500, totalCredit: 2750 })]));

      const parsed = parse(await handlers.credit_packs({}));

      expect(parsed.total).toBe(1);
      expect(parsed.packs[0].id).toBe('p-1');
      expect(parsed.packs[0].priceUsd).toBe(25);
      expect(parsed.packs[0].credits).toBe(2750);
    });

    it('should return toolError on failure', async () => {
      mockClient.listProducts.mockRejectedValue(new Error('products down'));

      const result = await handlers.credit_packs({});

      expect((result as { isError: boolean }).isError).toBe(true);
    });
  });

  describe('credit_purchase', () => {
    it('should purchase with a generated requestId and refresh balance', async () => {
      mockClient.purchaseCredits.mockResolvedValue(makeTransaction());
      mockClient.getWalletBalance.mockResolvedValue(makeWallet({ total: 2000 }));

      const parsed = parse(await handlers.credit_purchase({ productId: 'prod-1', requestId: undefined }));

      expect(mockClient.purchaseCredits).toHaveBeenCalledWith('prod-1', expect.any(String));
      expect(parsed.requestId).toBeTruthy();
      expect(parsed.balance).toBe(2000);
    });

    it('should reuse a provided requestId (idempotency)', async () => {
      mockClient.purchaseCredits.mockResolvedValue(makeTransaction());
      mockClient.getWalletBalance.mockResolvedValue(makeWallet());

      await handlers.credit_purchase({ productId: 'prod-1', requestId: 'fixed-req' });

      expect(mockClient.purchaseCredits).toHaveBeenCalledWith('prod-1', 'fixed-req');
    });

    it('should still succeed when balance refresh fails', async () => {
      mockClient.purchaseCredits.mockResolvedValue(makeTransaction());
      mockClient.getWalletBalance.mockRejectedValue(new Error('balance down'));

      const result = await handlers.credit_purchase({ productId: 'prod-1', requestId: 'r' });

      expect((result as { isError?: boolean }).isError).toBeUndefined();
      expect(parse(result).balance).toBeUndefined();
    });

    it('should return toolError when purchase fails', async () => {
      mockClient.purchaseCredits.mockRejectedValue(new Error('402 no card'));

      const result = await handlers.credit_purchase({ productId: 'prod-1', requestId: 'r' });

      expect((result as { isError: boolean }).isError).toBe(true);
    });
  });

  describe('credit_history', () => {
    it('should summarize transactions and pass filters', async () => {
      mockClient.listTransactions.mockResolvedValue(makeListResult([makeTransaction({ id: 't-9', creditChange: -50, stereo: 'use' })]));

      const parsed = parse(await handlers.credit_history({ stereo: 'use', limit: 10, page: 1 }));

      expect(mockClient.listTransactions).toHaveBeenCalledWith({ stereo: 'use', limit: 10, page: 1 });
      expect(parsed.transactions[0].id).toBe('t-9');
      expect(parsed.transactions[0].creditChange).toBe(-50);
    });

    it('should return toolError on failure', async () => {
      mockClient.listTransactions.mockRejectedValue(new Error('history down'));

      const result = await handlers.credit_history({ stereo: undefined, limit: undefined, page: undefined });

      expect((result as { isError: boolean }).isError).toBe(true);
    });
  });
});
