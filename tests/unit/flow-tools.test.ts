import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isWritableNodeId, resolveNodeId } from '../../src/tools/flow-tools';
import { registerFlowTools, registerNodeTools } from '../../src/tools';
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

// Capture tool handlers registered via McpServer.registerTool.
// Parameterized by the register function: node_delete lives in node-tools but its dangling-edge scan
// reads the same loadFlow response the edge dedup touches, so both are exercised from this file.
type ToolHandler = (...args: unknown[]) => Promise<unknown>;
type RegisterTools = (server: McpServer, client: never, config: ReturnType<typeof makeConfig>) => void;

const captureFrom = (register: RegisterTools, mockClient: MockApiClient) => {
  const handlers: Record<string, ToolHandler> = {};
  const mockServer = {
    registerTool: vi.fn((name: string, _meta: unknown, handler: ToolHandler) => {
      handlers[name] = handler;
    }),
    sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpServer;

  register(mockServer, mockClient as never, makeConfig({ FLOW_WS_URL: '' }));
  return handlers;
};

const captureHandlers = (mockClient: MockApiClient) => captureFrom(registerFlowTools, mockClient);
const captureNodeHandlers = (mockClient: MockApiClient) => captureFrom(registerNodeTools, mockClient);

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

// The server upserts by id and rewrites/reserves four characters (see isWritableNodeId's comment).
// A caller-supplied id carrying one of them lands on the wrong row instead of failing loudly.
describe('isWritableNodeId', () => {
  it('rejects an id the server would truncate at "-"', () => {
    expect(isWritableNodeId('n123-456')).toBe(false);
  });

  it('rejects the port, run and delete markers', () => {
    expect(isWritableNodeId('n1:out')).toBe(false);
    expect(isWritableNodeId('n1@2')).toBe(false);
    expect(isWritableNodeId('#n1')).toBe(false);
  });

  it('accepts client-minted and server-issued ids', () => {
    expect(isWritableNodeId('n8f3ac21d')).toBe(true);
    expect(isWritableNodeId('1011132')).toBe(true);
  });
});

describe('flow_save input schema', () => {
  // Capture the registered meta so the guard is asserted where it actually runs: tool input
  // validation, not the handler (handlers receive already-parsed args).
  const inputSchemaFor = (tool: string) => {
    const metas: Record<string, { inputSchema: { safeParse: (v: unknown) => { success: boolean } } }> = {};
    const mockServer = {
      registerTool: vi.fn((name: string, meta: unknown) => {
        metas[name] = meta as (typeof metas)[string];
      }),
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as McpServer;
    registerFlowTools(mockServer, makeApiClient() as never, makeConfig({ FLOW_WS_URL: '' }));
    return metas[tool].inputSchema;
  };

  const body = (id: string) => ({
    flowId: 'f-1',
    nodes: [{ id, type: 'input-text', position: { x: 0, y: 0 } }],
    edges: [],
  });

  it('rejects a node id containing "-"', () => {
    expect(inputSchemaFor('flow_save').safeParse(body('n1-2')).success).toBe(false);
  });

  it('accepts a hex-shaped node id', () => {
    expect(inputSchemaFor('flow_save').safeParse(body('n8f3ac21d')).success).toBe(true);
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
      expect(parsed.flows[0].url).toBe('https://flow.example.com/flows/f-1');
    });

    it('should pass isPublic filter', async () => {
      mockClient.listFlows.mockResolvedValue(makeListResult([]));

      await handlers.flow_list({ isPublic: true });

      expect(mockClient.listFlows).toHaveBeenCalledWith({ isPublic: true });
    });

    it('should pass page through (default undefined)', async () => {
      mockClient.listFlows.mockResolvedValue(makeListResult([]));

      await handlers.flow_list({ isPublic: undefined, page: 3 });

      expect(mockClient.listFlows).toHaveBeenCalledWith({ isPublic: undefined, page: 3 });
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
      expect(parsed.url).toBe('https://flow.example.com/flows/f-1');
    });

    it('should return toolError on failure', async () => {
      mockClient.loadFlow.mockRejectedValue(new Error('Not found'));

      const result = await handlers.flow_load({ flowId: 'bad' });

      expect((result as { isError: boolean }).isError).toBe(true);
    });
  });

  describe('flow_create', () => {
    it('should save graph then set name via metadata upsert (no name in save body)', async () => {
      const created = makeSaveFlow({ id: 'new-1', nodes: [makeNode({ id: 'n-0' })] });
      mockClient.saveFlow.mockResolvedValue(created);
      mockClient.upsertFlow.mockResolvedValue(makeSaveFlow({ id: 'new-1', name: 'New' }));

      await handlers.flow_create({ name: 'New', description: undefined, nodes: [{ type: 'input-text', position: { x: 0, y: 0 } }], edges: undefined });

      // Save body carries only { nodes, edges } — never name/description.
      expect(mockClient.saveFlow).toHaveBeenCalledTimes(1);
      expect(mockClient.saveFlow).toHaveBeenCalledWith('0', { nodes: [{ type: 'input-text', position: { x: 0, y: 0 } }], edges: [] });
      expect(mockClient.upsertFlow).toHaveBeenCalledWith('new-1', { name: 'New' });
    });

    it('should call saveFlow twice when edges are provided (index resolution)', async () => {
      const createdNodes = [makeNode({ id: 'real-a' }), makeNode({ id: 'real-b' })];
      const created = makeSaveFlow({ id: 'new-1', nodes: createdNodes });
      const saved = makeSaveFlow({ id: 'new-1', nodes: createdNodes, edges: [] });

      mockClient.saveFlow
        .mockResolvedValueOnce(created)  // first call: create
        .mockResolvedValueOnce(saved);    // second call: save with edges
      mockClient.upsertFlow.mockResolvedValue(makeSaveFlow({ id: 'new-1', name: 'Wired' }));

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
      // Name persisted via metadata upsert, not the save body.
      expect(mockClient.upsertFlow).toHaveBeenCalledWith('new-1', { name: 'Wired' });
    });

    it('should skip second save when created.nodes is empty', async () => {
      const created = makeSaveFlow({ id: 'new-1', nodes: [] });
      mockClient.saveFlow.mockResolvedValue(created);
      mockClient.upsertFlow.mockResolvedValue(makeSaveFlow({ id: 'new-1', name: 'Empty' }));

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
    it('should send graph to save body and name/description via metadata upsert', async () => {
      mockClient.saveFlow.mockResolvedValue(makeSaveFlow({ id: 'f-1' }));
      mockClient.upsertFlow.mockResolvedValue(makeSaveFlow({ id: 'f-1', name: 'Updated' }));

      await handlers.flow_save({
        flowId: 'f-1',
        name: 'Updated',
        description: 'desc',
        nodes: [{ type: 'input-text', position: { x: 0, y: 0 } }],
        edges: [],
      });

      // SaveFlowBody carries only { nodes, edges } — never name/description.
      expect(mockClient.saveFlow).toHaveBeenCalledWith('f-1', {
        nodes: [{ type: 'input-text', position: { x: 0, y: 0 } }],
        edges: [],
      });
      expect(mockClient.upsertFlow).toHaveBeenCalledWith('f-1', { name: 'Updated', description: 'desc' });
    });

    it('should save edges in a second call with indices resolved to saved node IDs', async () => {
      const savedNodes = [makeNode({ id: 'real-a' }), makeNode({ id: 'real-b' })];
      const saved = makeSaveFlow({ id: 'f-1', nodes: savedNodes, edges: [] });

      mockClient.saveFlow
        .mockResolvedValueOnce(saved) // first call: nodes only (edges stripped)
        .mockResolvedValueOnce(saved); // second call: edges with real IDs
      mockClient.upsertFlow.mockResolvedValue(makeSaveFlow({ id: 'f-1', name: 'Rebuilt' }));

      await handlers.flow_save({
        flowId: 'f-1',
        name: 'Rebuilt',
        description: undefined,
        nodes: [
          { type: 'input-text', position: { x: 0, y: 0 } },
          { type: 'output-text', position: { x: 200, y: 0 } },
        ],
        edges: [{ sourceNodeId: '0', sourcePortId: 'out', targetNodeId: '1', targetPortId: 'in' }],
      });

      expect(mockClient.saveFlow).toHaveBeenCalledTimes(2);
      // First call must strip edges so the backend does not orphan them.
      expect(mockClient.saveFlow.mock.calls[0][1].edges).toEqual([]);
      // Save body never carries name — that goes through the metadata upsert.
      expect(mockClient.saveFlow.mock.calls[0][1].name).toBeUndefined();
      // Second call resolves index refs to the real saved node IDs.
      const secondCall = mockClient.saveFlow.mock.calls[1];
      expect(secondCall[1].edges[0].sourceNodeId).toBe('real-a');
      expect(secondCall[1].edges[0].targetNodeId).toBe('real-b');
      // Name persisted via metadata upsert.
      expect(mockClient.upsertFlow).toHaveBeenCalledWith('f-1', { name: 'Rebuilt' });
    });

    it('should remap edges that reference pre-save node IDs to the reassigned IDs', async () => {
      // The user's real failure: nodes carry their existing IDs and edges reference those same
      // IDs, but /save reassigns them. Edges must follow the reassignment, not point at dead IDs.
      const savedNodes = [makeNode({ id: 'new-a' }), makeNode({ id: 'new-b' })];
      const saved = makeSaveFlow({ id: 'f-1', nodes: savedNodes, edges: [] });

      mockClient.saveFlow.mockResolvedValueOnce(saved).mockResolvedValueOnce(saved);

      await handlers.flow_save({
        flowId: 'f-1',
        name: undefined,
        description: undefined,
        nodes: [
          { id: 'old-a', type: 'input-text', position: { x: 0, y: 0 } },
          { id: 'old-b', type: 'output-text', position: { x: 200, y: 0 } },
        ],
        edges: [{ sourceNodeId: 'old-a', sourcePortId: 'out', targetNodeId: 'old-b', targetPortId: 'in' }],
      });

      const secondCall = mockClient.saveFlow.mock.calls[1];
      expect(secondCall[1].edges[0].sourceNodeId).toBe('new-a');
      expect(secondCall[1].edges[0].targetNodeId).toBe('new-b');
      // No metadata upsert when name/description are absent.
      expect(mockClient.upsertFlow).not.toHaveBeenCalled();
    });

    it('should return toolError on failure', async () => {
      mockClient.saveFlow.mockRejectedValue(new Error('save failed'));

      const result = await handlers.flow_save({ flowId: 'f-1', name: undefined, description: undefined, nodes: [], edges: [] });

      expect((result as { isError: boolean }).isError).toBe(true);
    });
  });

  // flow_export/flow_clone must carry the fields that decide how a flow behaves; `edge_create`
  // posts `id: ''` so the server mints a row each time, and duplicates surface on read.
  describe('portable fields and duplicate edges', () => {
    const dupEdge = { sourceNodeId: 'n-1', sourcePortId: 'out', targetNodeId: 'n-2', targetPortId: 'in' };
    // Two rows for one connection — what repeated edge_create calls leave on the server.
    const flowWithDupEdges = () =>
      makeSaveFlow({
        id: 'f-1',
        nodes: [makeNode({ id: 'n-1' }), makeNode({ id: 'n-2' })],
        edges: [
          { ...dupEdge, id: 'e-1' },
          { ...dupEdge, id: 'e-2' },
        ],
      });

    it('flow_export keeps blockId, autoExecutionEnabled, disabled and description', async () => {
      mockClient.loadFlow.mockResolvedValue(
        makeSaveFlow({
          id: 'f-1',
          nodes: [
            makeNode({
              id: 'n-1',
              blockId: 'block-9',
              description: 'seed',
              disabled: true,
              autoExecutionEnabled: false,
              status: 'COMPLETED',
              errorMessage: 'old failure',
            }),
          ],
          edges: [],
        }),
      );

      const result = await handlers.flow_export({ flowId: 'f-1' });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

      expect(parsed.nodes[0]).toMatchObject({
        blockId: 'block-9',
        description: 'seed',
        disabled: true,
        autoExecutionEnabled: false,
      });
      // Runtime state is still dropped — an export must not carry the last run with it.
      expect(parsed.nodes[0]).not.toHaveProperty('status');
      expect(parsed.nodes[0]).not.toHaveProperty('errorMessage');
    });

    it('flow_clone writes the portable fields into the save body', async () => {
      mockClient.loadFlow.mockResolvedValue(
        makeSaveFlow({
          id: 'f-1',
          name: 'Source',
          nodes: [makeNode({ id: 'n-1', blockId: '#input-text', autoExecutionEnabled: false, disabled: true })],
          edges: [],
        }),
      );
      mockClient.saveFlow.mockResolvedValue(makeSaveFlow({ id: 'f-2', nodes: [makeNode({ id: 'c-1' })] }));
      mockClient.upsertFlow.mockResolvedValue(makeSaveFlow({ id: 'f-2' }));

      await handlers.flow_clone({ flowId: 'f-1', name: undefined });

      // blockId must ride along: the server keeps a defined blockId as-is (fromNodeData._blockId),
      // and disabled/autoExecutionEnabled are the same server flag inverted — both must round-trip.
      expect(mockClient.saveFlow).toHaveBeenCalledWith('0', {
        nodes: [
          expect.objectContaining({ blockId: '#input-text', disabled: true, autoExecutionEnabled: false }),
        ],
        edges: [],
      });
    });

    it('flow_export collapses duplicate edges', async () => {
      mockClient.loadFlow.mockResolvedValue(flowWithDupEdges());

      const result = await handlers.flow_export({ flowId: 'f-1' });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

      expect(parsed.edges).toHaveLength(1);
    });

    it('flow_graph draws one arrow per duplicated edge', async () => {
      mockClient.loadFlow.mockResolvedValue(flowWithDupEdges());

      const result = await handlers.flow_graph({ flowId: 'f-1' });
      const { mermaid } = (result as { structuredContent: { mermaid: string } }).structuredContent;

      expect(mermaid.match(/n-1 --> n-2/g)).toHaveLength(1);
    });

    it('node_delete still deletes the server edge ids, duplicates included', async () => {
      const nodeHandlers = captureNodeHandlers(mockClient);
      mockClient.loadFlow.mockResolvedValue(flowWithDupEdges());
      mockClient.upsertFlow.mockResolvedValue(makeSaveFlow({ id: 'f-1' }));

      await nodeHandlers.node_delete({ flowId: 'f-1', nodeIds: ['n-1'] });

      expect(mockClient.upsertFlow).toHaveBeenCalledWith('f-1', {
        nodes: [{ id: '#n-1' }],
        edges: [{ id: '#e-1' }, { id: '#e-2' }],
      });
    });
  });

  describe('flow_publish', () => {
    it('should publish flow (isPublic=true) by default', async () => {
      mockClient.upsertFlow.mockResolvedValue({ id: 'f-1', isPublic: true });

      const result = await handlers.flow_publish({ flowId: 'f-1', isPublic: undefined });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

      expect(mockClient.upsertFlow).toHaveBeenCalledWith('f-1', { isPublic: true });
      expect(parsed.isPublic).toBe(true);
    });

    it('should unpublish when isPublic=false', async () => {
      mockClient.upsertFlow.mockResolvedValue({ id: 'f-1', isPublic: false });

      await handlers.flow_publish({ flowId: 'f-1', isPublic: false });

      expect(mockClient.upsertFlow).toHaveBeenCalledWith('f-1', { isPublic: false });
    });

    it('should return toolError on failure', async () => {
      mockClient.upsertFlow.mockRejectedValue(new Error('publish failed'));

      const result = await handlers.flow_publish({ flowId: 'f-1', isPublic: undefined });

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
