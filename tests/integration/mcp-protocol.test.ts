import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { registerDispatchTools, registerFlowPrompts, FLOW_PROMPTS } from '../../src/tools';
import { CredentialStore } from '../../src/auth/credentials';
import { makeConfig, makeFlow, makeBlock, makePortData, makeListResult, makeSaveFlow, makeNodeView, makeRun } from '../helpers/factories';
import type { FlowApiClient } from '../../src/api-client';

// Create a real McpServer (dispatch tools) with a mock API client. A non-empty env key keeps
// auth/status deterministic regardless of any ~/.eureka login file on the host.
const createTestServer = (mockClient: Record<string, ReturnType<typeof vi.fn>>) => {
  const server = new McpServer(
    { name: 'flow-mcp-test', version: '0.0.1' },
    { capabilities: { tools: {}, logging: {}, prompts: {} } },
  );
  registerDispatchTools(server, mockClient as unknown as FlowApiClient, makeConfig(), new CredentialStore('ec-test-env-key'));
  registerFlowPrompts(server);
  return server;
};

// Helpers to call actions through the four domain × access tools
const callOn =
  (tool: string) =>
  (client: Client, action: string, params?: Record<string, unknown>) =>
    client.callTool({ name: tool, arguments: { action, ...(params ? { params } : {}) } });
const flowReadCall = callOn('flow_read');
const flowDoCall = callOn('flow_do');
const creditReadCall = callOn('credit_read');
const creditDoCall = callOn('credit_do');
const authCall = callOn('auth');

describe('MCP Protocol Integration (dispatch tools)', () => {
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
      getWalletBalance: vi.fn().mockResolvedValue({ total: 1000, available: 1000, held: 0 }),
      listProducts: vi.fn().mockResolvedValue(makeListResult([{ id: 'prod-1', creditAmount: 1000, stripeAmount: 1000 }])),
      purchaseCredits: vi.fn().mockResolvedValue({ id: 'tx-1', stereo: 'purchase' }),
      listTransactions: vi.fn().mockResolvedValue(makeListResult([{ id: 'tx-1', stereo: 'purchase', creditChange: 1000 }])),
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

  it('should expose exactly five tools: flow_read, flow_do, credit_read, credit_do, auth', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['auth', 'credit_do', 'credit_read', 'flow_do', 'flow_read']);
  });

  it('should list every guided prompt template and return its content', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(FLOW_PROMPTS.map((p) => p.name).sort());

    const first = await client.getPrompt({ name: FLOW_PROMPTS[0].name });
    expect(first.messages[0].content).toMatchObject({ type: 'text' });
  });

  it('should have outputSchema on all tools', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.outputSchema, `${tool.name} missing outputSchema`).toBeDefined();
    }
  });

  it('should mark read tools readOnly and write tools not', async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.flow_read.annotations?.readOnlyHint).toBe(true);
    expect(byName.credit_read.annotations?.readOnlyHint).toBe(true);
    expect(byName.flow_do.annotations?.readOnlyHint).toBeFalsy();
    expect(byName.credit_do.annotations?.readOnlyHint).toBeFalsy();
    expect(byName.auth.annotations?.readOnlyHint).toBeFalsy();
  });

  it('should route flow_read/profile_get', async () => {
    const response = await flowReadCall(client, 'profile_get');
    const data = response.structuredContent as Record<string, unknown>;
    expect(data.sid).toBe('s1');
    expect(data.hasGeminiApiKey).toBe(true);
  });

  it('should route flow_read/flow_list', async () => {
    const response = await flowReadCall(client, 'flow_list');
    const data = response.structuredContent as Record<string, unknown>;
    expect(data.total).toBe(1);
    expect((data.flows as Array<Record<string, unknown>>)[0].id).toBe('flow-1');
  });

  it('should route flow_read/flow_graph with params', async () => {
    const response = await flowReadCall(client, 'flow_graph', { flowId: 'flow-1' });
    const data = response.structuredContent as Record<string, unknown>;
    expect(data.flowId).toBe('flow-1');
    expect(data.mermaid).toContain('graph LR');
  });

  it('should route flow_read/node_get_port with params', async () => {
    const response = await flowReadCall(client, 'node_get_port', { nodeId: 'n-1', portId: 'out', direction: 'out' });
    expect(response.structuredContent).toBeDefined();
    expect(mockApi.getPortData).toHaveBeenCalledWith('n-1', 'out', 'out', {
      flowId: undefined,
      runId: undefined,
    });
  });

  it('should route flow_do/flow_create (write)', async () => {
    const response = await flowDoCall(client, 'flow_create', { name: 'New', nodes: [], edges: [] });
    expect(response.isError).toBeFalsy();
    expect(mockApi.saveFlow).toHaveBeenCalled();
  });

  it('should route credit_read/credit_balance', async () => {
    const response = await creditReadCall(client, 'credit_balance');
    const data = response.structuredContent as Record<string, unknown>;
    expect(data.total).toBe(1000);
  });

  it('should route credit_read/credit_history', async () => {
    const response = await creditReadCall(client, 'credit_history');
    const data = response.structuredContent as Record<string, unknown>;
    expect((data.transactions as unknown[]).length).toBe(1);
  });

  it('should route credit_do/credit_purchase (write)', async () => {
    const response = await creditDoCall(client, 'credit_purchase', { productId: 'prod-1' });
    expect(response.isError).toBeFalsy();
    expect(mockApi.purchaseCredits).toHaveBeenCalled();
  });

  it('should route auth/status (authenticated via env key)', async () => {
    const response = await authCall(client, 'status');
    const data = response.structuredContent as Record<string, unknown>;
    expect(data.authenticated).toBe(true);
    expect(data.source).toBe('env');
    expect(data.uid).toBe('u1');
  });

  it('should route auth/logout', async () => {
    const response = await authCall(client, 'logout');
    const data = response.structuredContent as Record<string, unknown>;
    expect(response.isError).toBeFalsy();
    expect(data.message).toMatch(/logged out/i);
  });

  it('should propagate structured errors through the dispatcher', async () => {
    mockApi.listFlows.mockRejectedValue(new Error('Service unavailable'));
    const response = await flowReadCall(client, 'flow_list');
    expect(response.isError).toBe(true);
    expect((response.structuredContent as Record<string, unknown>).error).toBe('Service unavailable');
  });

  it('should reject a write action on a read tool', async () => {
    const response = await flowReadCall(client, 'flow_create', { name: 'x' });
    expect(response.isError).toBe(true);
  });

  it('should reject a credit action on a flow tool', async () => {
    const response = await flowReadCall(client, 'credit_balance');
    expect(response.isError).toBe(true);
  });

  it('should reject a flow action on a credit tool', async () => {
    const response = await creditDoCall(client, 'flow_create', { name: 'x' });
    expect(response.isError).toBe(true);
  });

  it('should reject a flow action on the auth tool', async () => {
    const response = await authCall(client, 'flow_create', { name: 'x' });
    expect(response.isError).toBe(true);
  });

  it('should reject an auth action on a flow tool', async () => {
    const response = await flowReadCall(client, 'login');
    expect(response.isError).toBe(true);
  });

  it('should reject invalid params for an action', async () => {
    // flow_publish requires flowId; omit it
    const response = await flowDoCall(client, 'flow_publish', {});
    expect(response.isError).toBe(true);
  });
});
