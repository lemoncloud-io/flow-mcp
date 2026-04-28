import { describe, it, expect, vi, beforeEach } from 'vitest';
import { completableFlowId, completableBlockType, completableStereo, resetFlowCache } from '../../src/tools/completions';
import { getCompleter, isCompletable } from '@modelcontextprotocol/sdk/server/completable.js';
import { makeListResult, makeFlow, makeBlock } from '../helpers/factories';
import type { FlowApiClient } from '../../src/api-client';

const createMockClient = () => ({
  listFlows: vi.fn().mockResolvedValue(makeListResult([
    makeFlow({ id: 'flow-abc', name: 'My Flow' }),
    makeFlow({ id: 'flow-xyz', name: 'Other Flow' }),
  ])),
  listBlocks: vi.fn().mockResolvedValue(makeListResult([
    makeBlock({ processType: 'input-text', name: 'input-text' }),
    makeBlock({ processType: 'text-transform', name: 'text-transform' }),
    makeBlock({ processType: 'ai-text', name: 'ai-text' }),
  ])),
} as unknown as FlowApiClient);

describe('completableFlowId', () => {
  beforeEach(() => {
    resetFlowCache();
  });

  it('should return a completable schema', () => {
    const client = createMockClient();
    const schema = completableFlowId(client);

    expect(isCompletable(schema)).toBe(true);
  });

  it('should filter flows by ID prefix', async () => {
    const client = createMockClient();
    const schema = completableFlowId(client);
    const completer = getCompleter(schema)!;

    const results = await completer('flow-a');

    expect(results).toEqual(['flow-abc']);
  });

  it('should filter flows by name (case-insensitive)', async () => {
    const client = createMockClient();
    const schema = completableFlowId(client);
    const completer = getCompleter(schema)!;

    const results = await completer('other');

    expect(results).toEqual(['flow-xyz']);
  });

  it('should cache flow list for 30 seconds', async () => {
    const client = createMockClient();
    const schema = completableFlowId(client);
    const completer = getCompleter(schema)!;

    await completer('');
    await completer('');

    expect((client as unknown as Record<string, ReturnType<typeof vi.fn>>).listFlows).toHaveBeenCalledTimes(1);
  });
});

describe('completableBlockType', () => {
  it('should filter block types by partial match', async () => {
    const client = createMockClient();
    const schema = completableBlockType(client);
    const completer = getCompleter(schema)!;

    const results = await completer('text');

    expect(results).toEqual(['input-text', 'text-transform', 'ai-text']);
  });

  it('should be case-insensitive', async () => {
    const client = createMockClient();
    const schema = completableBlockType(client);
    const completer = getCompleter(schema)!;

    const results = await completer('AI');

    expect(results).toEqual(['ai-text']);
  });
});

describe('completableStereo', () => {
  it('should filter stereo values', () => {
    const completer = getCompleter(completableStereo)!;

    expect(completer('in')).toEqual(['input']);
    expect(completer('p')).toEqual(['process']);
    expect(completer('o')).toEqual(['output']);
    expect(completer('')).toEqual(['input', 'process', 'output']);
  });
});
