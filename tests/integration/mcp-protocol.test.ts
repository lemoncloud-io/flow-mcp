import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { registerFlowTools, registerNodeTools, registerBlockTools } from '../../src/tools';
import { makeConfig, makeFlow, makeBlock, makePortData, makeListResult, makeSaveFlow, makeNodeView } from '../helpers/factories';
import type { FlowApiClient } from '../../src/api-client';

// Create a real McpServer with mock API client
const createTestServer = (mockClient: Record<string, ReturnType<typeof vi.fn>>) => {
  const server = new McpServer(
    { name: 'flow-mcp-test', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );
  const config = makeConfig();

  registerFlowTools(server, mockClient as unknown as FlowApiClient, config);
  registerNodeTools(server, mockClient as unknown as FlowApiClient, config);
  registerBlockTools(server, mockClient as unknown as FlowApiClient);

  return server;
};

describe('MCP Protocol Integration', () => {
  let server: McpServer;
  let client: Client;
  let mockApi: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    mockApi = {
      listFlows: vi.fn().mockResolvedValue(makeListResult([makeFlow()])),
      loadFlow: vi.fn().mockResolvedValue(makeSaveFlow()),
      saveFlow: vi.fn().mockResolvedValue(makeSaveFlow()),
      runFlow: vi.fn().mockResolvedValue(makeFlow({ status: 'completed' })),
      runNode: vi.fn().mockResolvedValue(makeNodeView({ status: 'COMPLETED' })),
      getPortData: vi.fn().mockResolvedValue(makePortData()),
      listBlocks: vi.fn().mockResolvedValue(makeListResult([makeBlock()])),
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

  it('should list all 10 tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual([
      'block_list',
      'flow_create',
      'flow_graph',
      'flow_list',
      'flow_load',
      'flow_run',
      'flow_save',
      'node_get_port',
      'node_run',
      'node_update',
    ]);
  });

  it('should invoke flow_list and return valid JSON', async () => {
    const response = await client.callTool({ name: 'flow_list', arguments: {} });
    const text = (response.content as Array<{ type: string; text: string }>)[0].text;
    const data = JSON.parse(text);

    expect(data.total).toBe(1);
    expect(data.flows).toHaveLength(1);
    expect(data.flows[0].id).toBe('flow-1');
  });

  it('should invoke block_list with stereo filter', async () => {
    mockApi.listBlocks.mockResolvedValue(
      makeListResult([
        makeBlock({ id: 'b1', stereo: 'input', isHidden: false }),
        makeBlock({ id: 'b2', stereo: 'process', isHidden: false }),
      ]),
    );

    const response = await client.callTool({ name: 'block_list', arguments: { stereo: 'input' } });
    const data = JSON.parse((response.content as Array<{ type: string; text: string }>)[0].text);

    expect(data.total).toBe(1);
    expect(data.blocks[0].id).toBe('b1');
  });

  it('should return isError on API failure', async () => {
    mockApi.listFlows.mockRejectedValue(new Error('Service unavailable'));

    const response = await client.callTool({ name: 'flow_list', arguments: {} });

    expect(response.isError).toBe(true);
    expect((response.content as Array<{ text: string }>)[0].text).toContain('Service unavailable');
  });

  it('should invoke node_get_port successfully', async () => {
    const response = await client.callTool({
      name: 'node_get_port',
      arguments: { nodeId: 'n-1', portId: 'out', direction: 'out' },
    });
    const data = JSON.parse((response.content as Array<{ type: string; text: string }>)[0].text);

    expect(data.data.type).toBe('text');
    expect(mockApi.getPortData).toHaveBeenCalledWith('n-1', 'out', 'out');
  });
});
