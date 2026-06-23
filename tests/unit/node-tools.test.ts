import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerNodeTools } from '../../src/tools';
import {
  makeApiClient,
  makeConfig,
  makeNode,
  makeNodeView,
  makePortData,
  makeSaveFlow,
  type MockApiClient,
} from '../helpers/factories';
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

  registerNodeTools(mockServer, mockClient as never, makeConfig({ FLOW_WS_URL: '' }));
  return handlers;
};

describe('node tool handlers', () => {
  let mockClient: MockApiClient;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    mockClient = makeApiClient();
    handlers = captureHandlers(mockClient);
  });

  describe('node_create', () => {
    it('should add the node via upsertFlow (graph merge) and return the new node', async () => {
      mockClient.loadFlow.mockResolvedValue(makeSaveFlow({ id: 'f-1', nodes: [makeNode({ id: 'existing' })] }));
      mockClient.upsertFlow.mockResolvedValue(
        makeSaveFlow({ id: 'f-1', nodes: [makeNode({ id: 'existing' }), makeNode({ id: 'new-1', type: 'input-text' })] }),
      );

      const result = await handlers.node_create({
        flowId: 'f-1',
        blockId: 'input-text',
        position: { x: 0, y: 0 },
        config: undefined,
        customLabel: undefined,
      });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

      // Node joins the flow graph via upsertFlow — a bare /nodes/0/upsert would orphan it.
      expect(mockClient.upsertFlow).toHaveBeenCalledWith(
        'f-1',
        expect.objectContaining({ nodes: [expect.objectContaining({ type: 'input-text' })], edges: [] }),
      );
      expect(mockClient.upsertNode).not.toHaveBeenCalled();
      // Returns the newly created node (the id that was not present before).
      expect(parsed.id).toBe('new-1');
    });
  });

  describe('node_run', () => {
    it('should call runNode with sync fallback when WS not configured', async () => {
      mockClient.runNode.mockResolvedValue(makeNodeView({ status: 'COMPLETED' }));

      const result = await handlers.node_run({
        nodeId: 'n-1',
        flowId: 'f-1',
        propagate: undefined,
        config: undefined,
        timeout: undefined,
      });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

      expect(mockClient.runNode).toHaveBeenCalledWith('n-1', { propagate: false, config: undefined });
      expect(parsed.status).toBe('COMPLETED');
    });

    it('should pass propagate=true', async () => {
      mockClient.runNode.mockResolvedValue(makeNodeView());

      await handlers.node_run({
        nodeId: 'n-1',
        flowId: 'f-1',
        propagate: true,
        config: undefined,
        timeout: undefined,
      });

      expect(mockClient.runNode).toHaveBeenCalledWith('n-1', { propagate: true, config: undefined });
    });

    it('should pass config', async () => {
      mockClient.runNode.mockResolvedValue(makeNodeView());

      await handlers.node_run({
        nodeId: 'n-1',
        flowId: 'f-1',
        propagate: undefined,
        config: { k: 'v' },
        timeout: undefined,
      });

      expect(mockClient.runNode).toHaveBeenCalledWith('n-1', { propagate: false, config: { k: 'v' } });
    });

    it('should return toolError on failure', async () => {
      mockClient.runNode.mockRejectedValue(new Error('node run failed'));

      const result = await handlers.node_run({
        nodeId: 'n-1',
        flowId: 'f-1',
        propagate: undefined,
        config: undefined,
        timeout: undefined,
      });

      expect((result as { isError: boolean }).isError).toBe(true);
    });
  });

  describe('node_get_port', () => {
    it('should call getPortData with correct params', async () => {
      mockClient.getPortData.mockResolvedValue(makePortData());

      const result = await handlers.node_get_port({ nodeId: 'n-1', portId: 'out', direction: 'out' });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

      expect(mockClient.getPortData).toHaveBeenCalledWith('n-1', 'out', 'out', {
        flowId: undefined,
        runId: undefined,
      });
      expect(parsed.data.type).toBe('text');
    });

    it('should return toolError on failure', async () => {
      mockClient.getPortData.mockRejectedValue(new Error('port not found'));

      const result = await handlers.node_get_port({ nodeId: 'n-1', portId: 'in', direction: 'in' });

      expect((result as { isError: boolean }).isError).toBe(true);
    });
  });
});
