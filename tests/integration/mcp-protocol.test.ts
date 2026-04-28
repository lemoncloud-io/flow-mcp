import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { registerFlowTools, registerNodeTools, registerBlockTools, registerRunTools } from '../../src/tools';
import { makeConfig, makeFlow, makeBlock, makePortData, makeListResult, makeSaveFlow, makeNodeView, makeRun } from '../helpers/factories';
import type { FlowApiClient } from '../../src/api-client';

// Create a real McpServer with mock API client
const createTestServer = (mockClient: Record<string, ReturnType<typeof vi.fn>>) => {
  const server = new McpServer(
    { name: 'flow-mcp-test', version: '0.0.1' },
    { capabilities: { tools: {}, logging: {} } },
  );
  const config = makeConfig();

  registerFlowTools(server, mockClient as unknown as FlowApiClient, config);
  registerNodeTools(server, mockClient as unknown as FlowApiClient, config);
  registerBlockTools(server, mockClient as unknown as FlowApiClient);
  registerRunTools(server, mockClient as unknown as FlowApiClient);

  return server;
};

describe('MCP Protocol Integration', () => {
  let server: McpServer;
  let client: Client;
  let mockApi: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    mockApi = {
      getProfile: vi.fn().mockResolvedValue({ sid: 's1', uid: 'u1', geminiApiKey: 'k', openaiApiKey: 'k' }),
      listFlows: vi.fn().mockResolvedValue(makeListResult([makeFlow()])),
      loadFlow: vi.fn().mockResolvedValue(makeSaveFlow()),
      saveFlow: vi.fn().mockResolvedValue(makeSaveFlow()),
      upsertFlow: vi.fn().mockResolvedValue({ id: 'flow-1' }),
      runFlow: vi.fn().mockResolvedValue(makeFlow({ status: 'completed' })),
      runNode: vi.fn().mockResolvedValue(makeNodeView({ status: 'COMPLETED' })),
      upsertNode: vi.fn().mockResolvedValue(makeNodeView()),
      getPortData: vi.fn().mockResolvedValue(makePortData()),
      listBlocks: vi.fn().mockResolvedValue(makeListResult([makeBlock()])),
      getNode: vi.fn().mockResolvedValue({ id: 'node-1', type: 'input-text', position: { x: 100, y: 200 } }),
      getBlock: vi.fn().mockResolvedValue(makeBlock()),
      listRuns: vi.fn().mockResolvedValue(makeListResult([makeRun()])),
      getRun: vi.fn().mockResolvedValue(makeRun()),
    };

    server = createTestServer(mockApi);

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('should list all 23 tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual([
      'block_get',
      'block_list',
      'edge_create',
      'edge_delete',
      'flow_clone',
      'flow_create',
      'flow_export',
      'flow_graph',
      'flow_list',
      'flow_load',
      'flow_run',
      'flow_run_from',
      'flow_save',
      'flow_update',
      'node_create',
      'node_delete',
      'node_get',
      'node_get_port',
      'node_run',
      'node_update',
      'profile_get',
      'run_get',
      'run_list',
    ]);
  });

  it('should have outputSchema on all tools', async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.outputSchema, `${tool.name} missing outputSchema`).toBeDefined();
    }
  });

  it('should return structuredContent from flow_list', async () => {
    const response = await client.callTool({ name: 'flow_list', arguments: {} });

    expect(response.structuredContent).toBeDefined();
    const data = response.structuredContent as Record<string, unknown>;
    expect(data.total).toBe(1);
    expect((data.flows as Array<Record<string, unknown>>)[0].id).toBe('flow-1');
  });

  it('should return structuredContent from profile_get', async () => {
    const response = await client.callTool({ name: 'profile_get', arguments: {} });

    expect(response.structuredContent).toBeDefined();
    const data = response.structuredContent as Record<string, unknown>;
    expect(data.sid).toBe('s1');
    expect(data.hasGeminiApiKey).toBe(true);
  });

  it('should return structuredContent from flow_graph', async () => {
    const response = await client.callTool({ name: 'flow_graph', arguments: { flowId: 'flow-1' } });

    expect(response.structuredContent).toBeDefined();
    const data = response.structuredContent as Record<string, unknown>;
    expect(data.flowId).toBe('flow-1');
    expect(data.mermaid).toContain('graph LR');
  });

  it('should invoke block_list with stereo filter', async () => {
    mockApi.listBlocks.mockResolvedValue(
      makeListResult([
        makeBlock({ id: 'b1', stereo: 'input', isHidden: false }),
        makeBlock({ id: 'b2', stereo: 'process', isHidden: false }),
      ]),
    );

    const response = await client.callTool({ name: 'block_list', arguments: { stereo: 'input' } });

    expect(response.structuredContent).toBeDefined();
    const data = response.structuredContent as Record<string, unknown>;
    expect(data.total).toBe(1);
  });

  it('should return structured error on API failure', async () => {
    mockApi.listFlows.mockRejectedValue(new Error('Service unavailable'));

    const response = await client.callTool({ name: 'flow_list', arguments: {} });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toBeDefined();
    const data = response.structuredContent as Record<string, unknown>;
    expect(data.error).toBe('Service unavailable');
  });

  it('should invoke node_get_port and return structuredContent', async () => {
    const response = await client.callTool({
      name: 'node_get_port',
      arguments: { nodeId: 'n-1', portId: 'out', direction: 'out' },
    });

    expect(response.structuredContent).toBeDefined();
    expect(mockApi.getPortData).toHaveBeenCalledWith('n-1', 'out', 'out');
  });
});
