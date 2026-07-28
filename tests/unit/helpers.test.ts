import { describe, it, expect } from 'vitest';
import { toolResult, toolError, resolveOutputs } from '../../src/tools/helpers';
import { makeApiClient } from '../helpers/factories';

describe('toolResult', () => {
  it('should return both content and structuredContent', () => {
    const data = { id: '1', name: 'test' };
    const result = toolResult(data);

    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(data, null, 2) }]);
    expect(result.structuredContent).toEqual(data);
  });

  it('should return the same object reference in structuredContent', () => {
    const data = { flowId: 'f-1', status: 'completed' };
    const result = toolResult(data);

    expect(result.structuredContent).toBe(data);
  });

  it('should handle nested objects', () => {
    const data = { a: { b: [1, 2, 3] } };
    const result = toolResult(data);

    expect(JSON.parse(result.content[0].text)).toEqual(data);
  });

  it('should handle empty object', () => {
    const result = toolResult({});

    expect(result.content[0].text).toBe('{}');
  });
});

describe('toolError', () => {
  it('should extract message from Error instance', () => {
    const result = toolError(new Error('something failed'));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('something failed');
    expect(result.structuredContent).toEqual({ error: 'something failed' });
  });

  it('should include error code when present', () => {
    const err = Object.assign(new Error('not found'), { code: 'not_found' });
    const result = toolError(err);

    expect(result.content[0].text).toBe('[not_found] not found');
    expect(result.structuredContent).toEqual({ error: 'not found', code: 'not_found' });
  });

  it('should convert string via String()', () => {
    const result = toolError('raw string error');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('raw string error');
    expect(result.structuredContent).toEqual({ error: 'raw string error' });
  });

  it('should convert number via String()', () => {
    const result = toolError(42);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('42');
    expect(result.structuredContent).toEqual({ error: '42' });
  });

  it('should always set isError to true', () => {
    expect(toolError('any').isError).toBe(true);
    expect(toolError(new Error('any')).isError).toBe(true);
  });
});

// The out-ports come from ws-client.routeFrame already parsed and deduped; this only fetches values.
describe('resolveOutputs', () => {
  it('fetches each out-port run-scoped and returns its value', async () => {
    const client = makeApiClient();
    client.getPortData.mockResolvedValue({ data: { type: 'text', value: 'hello' } });

    const outputs = await resolveOutputs(client as never, 'f-1', [{ nodeId: 'n-1', portName: 'out', runId: 'r-1' }]);

    expect(client.getPortData).toHaveBeenCalledWith('n-1', 'out', 'out', { flowId: 'f-1', runId: 'r-1' });
    expect(outputs).toEqual([{ nodeId: 'n-1', port: 'out', value: 'hello', type: 'text' }]);
  });

  it('skips ports that fail to read or carry no value', async () => {
    const client = makeApiClient();
    client.getPortData
      .mockRejectedValueOnce(new Error('not readable'))
      .mockResolvedValueOnce({ data: { type: 'text' } });

    const outputs = await resolveOutputs(client as never, 'f-1', [
      { nodeId: 'n-1', portName: 'out', runId: 'r-1' },
      { nodeId: 'n-2', portName: 'out', runId: 'r-1' },
    ]);

    expect(outputs).toEqual([]);
  });
});
