import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerBlockTools, summarizeBlock } from '../../src/tools';
import { makeApiClient, makeBlock, makeBlockDef, makePortDef, makeListResult, type MockApiClient } from '../helpers/factories';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

type ToolHandler = (...args: unknown[]) => Promise<unknown>;

const captureHandlers = (mockClient: MockApiClient) => {
  const handlers: Record<string, ToolHandler> = {};
  const mockServer = {
    registerTool: vi.fn((name: string, _meta: unknown, handler: ToolHandler) => {
      handlers[name] = handler;
    }),
  } as unknown as McpServer;

  registerBlockTools(mockServer, mockClient as never);
  return handlers;
};

describe('summarizeBlock', () => {
  it('should prefer processType over $definition.type', () => {
    const block = makeBlock({ processType: 'from-processType', $definition: makeBlockDef({ type: 'from-def' }) });

    const summary = summarizeBlock(block);

    expect(summary.type).toBe('from-processType');
  });

  it('should fall back to $definition.type when processType is absent', () => {
    const block = makeBlock({ processType: undefined, $definition: makeBlockDef({ type: 'from-def' }) });

    const summary = summarizeBlock(block);

    expect(summary.type).toBe('from-def');
  });

  it('should prefer label over name', () => {
    const block = makeBlock({ label: 'Label', name: 'Name' });

    expect(summarizeBlock(block).label).toBe('Label');
  });

  it('should fall back to name when label is absent', () => {
    const block = makeBlock({ label: undefined, name: 'FallbackName' });

    expect(summarizeBlock(block).label).toBe('FallbackName');
  });

  it('should prefer description over $definition.description', () => {
    const block = makeBlock({ description: 'Direct', $definition: makeBlockDef({ description: 'DefDesc' }) });

    expect(summarizeBlock(block).description).toBe('Direct');
  });

  it('should fall back to $definition.description', () => {
    const block = makeBlock({ description: undefined, $definition: makeBlockDef({ description: 'DefDesc' }) });

    expect(summarizeBlock(block).description).toBe('DefDesc');
  });

  it('should prefer $definition.inputs over input$$', () => {
    const defInputs = [makePortDef({ id: 'def-in' })];
    const block = makeBlock({
      $definition: makeBlockDef({ inputs: defInputs }),
      input$$: [makePortDef({ id: 'legacy-in' })],
    });

    expect(summarizeBlock(block).inputs).toEqual(defInputs);
  });

  it('should fall back to input$$ when $definition.inputs absent', () => {
    const legacyInputs = [makePortDef({ id: 'legacy-in' })];
    const block = makeBlock({ $definition: undefined, input$$: legacyInputs });

    expect(summarizeBlock(block).inputs).toEqual(legacyInputs);
  });

  it('should return empty arrays when all optional fields absent', () => {
    const block = makeBlock({ $definition: undefined, input$$: undefined, output$$: undefined, config$$: undefined });

    const summary = summarizeBlock(block);

    expect(summary.inputs).toEqual([]);
    expect(summary.outputs).toEqual([]);
    expect(summary.configSchema).toEqual([]);
  });
});

describe('block_list handler', () => {
  let mockClient: MockApiClient;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    mockClient = makeApiClient();
    handlers = captureHandlers(mockClient);
  });

  it('should filter out hidden blocks', async () => {
    const blocks = [
      makeBlock({ id: 'visible', isHidden: false }),
      makeBlock({ id: 'hidden', isHidden: true }),
    ];
    mockClient.listBlocks.mockResolvedValue(makeListResult(blocks));

    const result = await handlers.block_list({ stereo: undefined });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

    expect(parsed.total).toBe(1);
    expect(parsed.blocks[0].id).toBe('visible');
  });

  it('should return all non-hidden blocks when no stereo filter', async () => {
    const blocks = [
      makeBlock({ id: 'b1', stereo: 'input', isHidden: false }),
      makeBlock({ id: 'b2', stereo: 'process', isHidden: false }),
    ];
    mockClient.listBlocks.mockResolvedValue(makeListResult(blocks));

    const result = await handlers.block_list({ stereo: undefined });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

    expect(parsed.total).toBe(2);
  });

  it('should filter by stereo when provided', async () => {
    const blocks = [
      makeBlock({ id: 'b1', stereo: 'input', isHidden: false }),
      makeBlock({ id: 'b2', stereo: 'process', isHidden: false }),
      makeBlock({ id: 'b3', stereo: 'output', isHidden: false }),
    ];
    mockClient.listBlocks.mockResolvedValue(makeListResult(blocks));

    const result = await handlers.block_list({ stereo: 'process' });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

    expect(parsed.total).toBe(1);
    expect(parsed.blocks[0].id).toBe('b2');
  });

  it('should apply summarizeBlock to each result', async () => {
    const blocks = [makeBlock({ id: 'b1', processType: 'my-type', label: 'My Label', isHidden: false })];
    mockClient.listBlocks.mockResolvedValue(makeListResult(blocks));

    const result = await handlers.block_list({ stereo: undefined });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

    expect(parsed.blocks[0].type).toBe('my-type');
    expect(parsed.blocks[0].label).toBe('My Label');
    expect(parsed.blocks[0]).toHaveProperty('inputs');
    expect(parsed.blocks[0]).toHaveProperty('outputs');
  });

  it('should return toolError on failure', async () => {
    mockClient.listBlocks.mockRejectedValue(new Error('blocks failed'));

    const result = await handlers.block_list({ stereo: undefined });

    expect((result as { isError: boolean }).isError).toBe(true);
  });
});
