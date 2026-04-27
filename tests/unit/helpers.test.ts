import { describe, it, expect } from 'vitest';
import { toolJson, toolError } from '../../src/tools/helpers';

describe('toolJson', () => {
  it('should wrap object as pretty-printed JSON text content', () => {
    const result = toolJson({ id: '1', name: 'test' });

    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ id: '1', name: 'test' }, null, 2) }],
    });
  });

  it('should handle null', () => {
    const result = toolJson(null);

    expect(result.content[0].text).toBe('null');
  });

  it('should handle nested objects', () => {
    const data = { a: { b: [1, 2, 3] } };
    const result = toolJson(data);

    expect(JSON.parse(result.content[0].text)).toEqual(data);
  });

  it('should handle empty object', () => {
    const result = toolJson({});

    expect(result.content[0].text).toBe('{}');
  });
});

describe('toolError', () => {
  it('should extract message from Error instance', () => {
    const result = toolError(new Error('something failed'));

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'something failed' }],
    });
  });

  it('should convert string via String()', () => {
    const result = toolError('raw string error');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('raw string error');
  });

  it('should convert number via String()', () => {
    const result = toolError(42);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('42');
  });

  it('should always set isError to true', () => {
    expect(toolError('any').isError).toBe(true);
    expect(toolError(new Error('any')).isError).toBe(true);
  });
});
