import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveNodeId } from '../../src/tools/flow-tools';
import { registerFlowTools } from '../../src/tools';
import {
  makeApiClient,
  makeConfig,
  makeFlow,
  makeSaveFlow,
  makeNode,
  makeListResult,
  type MockApiClient,
} from '../helpers/factories';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Capture tool handlers registered via McpServer.registerTool
type ToolHandler = (...args: unknown[]) => Promise<unknown>;
const captureHandlers = (mockClient: MockApiClient) => {
  const handlers: Record<string, ToolHandler> = {};
  const mockServer = {
    registerTool: vi.fn((name: string, _meta: unknown, handler: ToolHandler) => {
      handlers[name] = handler;
    }),
  } as unknown as McpServer;

  registerFlowTools(mockServer, mockClient as never, makeConfig());
  return handlers;
};

describe('resolveNodeId', () => {
  const nodes = [{ id: 'real-0' }, { id: 'real-1' }, { id: 'real-2' }];

  it('should resolve "0" to first node ID', () => {
    expect(resolveNodeId('0', nodes)).toBe('real-0');
  });

  it('should resolve "1" to second node ID', () => {
    expect(resolveNodeId('1', nodes)).toBe('real-1');
  });

  it('should return ref for out-of-bounds index', () => {
    expect(resolveNodeId('99', nodes)).toBe('99');
  });

  it('should passthrough non-numeric string', () => {
    expect(resolveNodeId('abc-123', nodes)).toBe('abc-123');
  });

  it('should passthrough "01" (String(1) !== "01")', () => {
    expect(resolveNodeId('01', nodes)).toBe('01');
  });

  it('should return ref when node at index has no id', () => {
    expect(resolveNodeId('0', [{ id: undefined }])).toBe('0');
  });

  it('should passthrough negative index', () => {
    expect(resolveNodeId('-1', nodes)).toBe('-1');
  });
});

describe('flow tool handlers', () => {
  let mockClient: MockApiClient;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    mockClient = makeApiClient();
    handlers = captureHandlers(mockClient);
  });

  describe('flow_list', () => {
    it('should return flow summary list', async () => {
      const flows = [makeFlow({ id: 'f-1', name: 'Flow 1' }), makeFlow({ id: 'f-2', name: 'Flow 2' })];
      mockClient.listFlows.mockResolvedValue(makeListResult(flows));

      const result = await handlers.flow_list({ isPublic: undefined });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

      expect(parsed.total).toBe(2);
      expect(parsed.flows[0].id).toBe('f-1');
      expect(parsed.flows[0].name).toBe('Flow 1');
    });

    it('should pass isPublic filter', async () => {
      mockClient.listFlows.mockResolvedValue(makeListResult([]));

      await handlers.flow_list({ isPublic: true });

      expect(mockClient.listFlows).toHaveBeenCalledWith({ isPublic: true });
    });

    it('should call without filter when isPublic is undefined', async () => {
      mockClient.listFlows.mockResolvedValue(makeListResult([]));

      await handlers.flow_list({ isPublic: undefined });

      expect(mockClient.listFlows).toHaveBeenCalledWith(undefined);
    });

    it('should return toolError on API failure', async () => {
      mockClient.listFlows.mockRejectedValue(new Error('API down'));

      const result = await handlers.flow_list({ isPublic: undefined });

      expect((result as { isError: boolean }).isError).toBe(true);
    });
  });

  describe('flow_load', () => {
    it('should return loaded flow', async () => {
      const flow = makeSaveFlow({ id: 'f-1' });
      mockClient.loadFlow.mockResolvedValue(flow);

      const result = await handlers.flow_load({ flowId: 'f-1' });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

      expect(parsed.id).toBe('f-1');
    });

    it('should return toolError on failure', async () => {
      mockClient.loadFlow.mockRejectedValue(new Error('Not found'));

      const result = await handlers.flow_load({ flowId: 'bad' });

      expect((result as { isError: boolean }).isError).toBe(true);
    });
  });

  describe('flow_create', () => {
    it('should create flow with single saveFlow call when no edges', async () => {
      const created = makeSaveFlow({ id: 'new-1', nodes: [makeNode({ id: 'n-0' })] });
      mockClient.saveFlow.mockResolvedValue(created);

      await handlers.flow_create({ name: 'New', description: undefined, nodes: [{ type: 'input-text', position: { x: 0, y: 0 } }], edges: undefined });

      expect(mockClient.saveFlow).toHaveBeenCalledTimes(1);
      expect(mockClient.saveFlow).toHaveBeenCalledWith('0', expect.objectContaining({ name: 'New', edges: [] }));
    });

    it('should call saveFlow twice when edges are provided (index resolution)', async () => {
      const createdNodes = [makeNode({ id: 'real-a' }), makeNode({ id: 'real-b' })];
      const created = makeSaveFlow({ id: 'new-1', nodes: createdNodes });
      const saved = makeSaveFlow({ id: 'new-1', nodes: createdNodes, edges: [] });

      mockClient.saveFlow
        .mockResolvedValueOnce(created)  // first call: create
        .mockResolvedValueOnce(saved);    // second call: save with edges

      const edges = [{ sourceNodeId: '0', sourcePortId: 'out', targetNodeId: '1', targetPortId: 'in' }];
      await handlers.flow_create({
        name: 'Wired',
        description: undefined,
        nodes: [
          { type: 'input-text', position: { x: 0, y: 0 } },
          { type: 'output-text', position: { x: 200, y: 0 } },
        ],
        edges,
      });

      expect(mockClient.saveFlow).toHaveBeenCalledTimes(2);
      // Second call should have resolved edge indices
      const secondCall = mockClient.saveFlow.mock.calls[1];
      expect(secondCall[0]).toBe('new-1');
      expect(secondCall[1].edges[0].sourceNodeId).toBe('real-a');
      expect(secondCall[1].edges[0].targetNodeId).toBe('real-b');
    });

    it('should skip second save when created.nodes is empty', async () => {
      const created = makeSaveFlow({ id: 'new-1', nodes: [] });
      mockClient.saveFlow.mockResolvedValue(created);

      const edges = [{ sourceNodeId: '0', sourcePortId: 'out', targetNodeId: '1', targetPortId: 'in' }];
      await handlers.flow_create({ name: 'Empty', description: undefined, nodes: [], edges });

      expect(mockClient.saveFlow).toHaveBeenCalledTimes(1);
    });

    it('should return toolError on failure', async () => {
      mockClient.saveFlow.mockRejectedValue(new Error('create failed'));

      const result = await handlers.flow_create({ name: 'Fail', description: undefined, nodes: undefined, edges: undefined });

      expect((result as { isError: boolean }).isError).toBe(true);
    });
  });

  describe('flow_save', () => {
    it('should pass all fields to saveFlow', async () => {
      mockClient.saveFlow.mockResolvedValue(makeSaveFlow());

      await handlers.flow_save({
        flowId: 'f-1',
        name: 'Updated',
        description: 'desc',
        nodes: [{ type: 'input-text', position: { x: 0, y: 0 } }],
        edges: [],
      });

      expect(mockClient.saveFlow).toHaveBeenCalledWith('f-1', {
        name: 'Updated',
        description: 'desc',
        nodes: [{ type: 'input-text', position: { x: 0, y: 0 } }],
        edges: [],
      });
    });

    it('should return toolError on failure', async () => {
      mockClient.saveFlow.mockRejectedValue(new Error('save failed'));

      const result = await handlers.flow_save({ flowId: 'f-1', name: undefined, description: undefined, nodes: [], edges: [] });

      expect((result as { isError: boolean }).isError).toBe(true);
    });
  });

  describe('flow_run', () => {
    it('should call runFlow with sync fallback when WS not configured', async () => {
      mockClient.runFlow.mockResolvedValue(makeFlow({ status: 'completed' }));

      const result = await handlers.flow_run({ flowId: 'f-1', config: undefined, timeout: undefined });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

      expect(mockClient.runFlow).toHaveBeenCalledWith('f-1', undefined);
      expect(parsed.status).toBe('completed');
    });

    it('should pass config to runFlow', async () => {
      mockClient.runFlow.mockResolvedValue(makeFlow());

      await handlers.flow_run({ flowId: 'f-1', config: { k: 'v' }, timeout: undefined });

      expect(mockClient.runFlow).toHaveBeenCalledWith('f-1', { config: { k: 'v' } });
    });

    it('should return toolError on failure', async () => {
      mockClient.runFlow.mockRejectedValue(new Error('run failed'));

      const result = await handlers.flow_run({ flowId: 'f-1', config: undefined, timeout: undefined });

      expect((result as { isError: boolean }).isError).toBe(true);
    });
  });
});
