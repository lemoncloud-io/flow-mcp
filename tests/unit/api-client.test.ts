import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlowApiClient, FlowApiError } from '../../src/api-client';
import { makeConfig, makeFlow, makeSaveFlow, makeNodeView, makePortData, makeBlock, makeListResult } from '../helpers/factories';

// Spy on axios methods via the internal client instance
const createClient = (configOverrides?: Parameters<typeof makeConfig>[0]) => {
  const config = makeConfig(configOverrides);
  const client = new FlowApiClient(config);
  // Access internal axios instance for spying
  const axiosInstance = (client as unknown as { client: { get: Function; post: Function; delete: Function } }).client;
  return { client, axiosInstance, config };
};

describe('FlowApiClient', () => {
  describe('constructor', () => {
    it('should strip trailing slash from FLOW_API_URL', () => {
      const { axiosInstance } = createClient({ FLOW_API_URL: 'https://api.example.com///' });

      expect(axiosInstance.defaults.baseURL).toMatch(/^https:\/\/api\.example\.com\/_apis$/);
    });

    it('should use /_api_ path for ec- prefixed keys', () => {
      const { axiosInstance } = createClient({ FLOW_API_KEY: 'ec-test-key' });

      expect(axiosInstance.defaults.baseURL).toContain('/_api_');
    });

    it('should use /_apis path for non-ec keys', () => {
      const { axiosInstance } = createClient({ FLOW_API_KEY: 'normal-key' });

      expect(axiosInstance.defaults.baseURL).toContain('/_apis');
    });

    it('should set x-api-key header', () => {
      const { axiosInstance } = createClient({ FLOW_API_KEY: 'my-secret-key' });

      expect(axiosInstance.defaults.headers['x-api-key']).toBe('my-secret-key');
    });
  });

  describe('listFlows', () => {
    it('should call GET /flows by default', async () => {
      const { client, axiosInstance } = createClient();
      const data = makeListResult([makeFlow()]);
      vi.spyOn(axiosInstance, 'get').mockResolvedValue({ data });

      const result = await client.listFlows();

      expect(axiosInstance.get).toHaveBeenCalledWith('/flows');
      expect(result).toEqual(data);
    });

    it('should call absolute /public/flows URL when isPublic is true', async () => {
      const { client, axiosInstance } = createClient();
      vi.spyOn(axiosInstance, 'get').mockResolvedValue({ data: makeListResult([]) });

      await client.listFlows({ isPublic: true });

      expect(axiosInstance.get).toHaveBeenCalledWith('https://api.example.com/public/flows');
    });

    it('should call GET /flows when isPublic is false', async () => {
      const { client, axiosInstance } = createClient();
      vi.spyOn(axiosInstance, 'get').mockResolvedValue({ data: makeListResult([]) });

      await client.listFlows({ isPublic: false });

      expect(axiosInstance.get).toHaveBeenCalledWith('/flows');
    });
  });

  describe('loadFlow', () => {
    it('should call GET /flows/:id/load', async () => {
      const { client, axiosInstance } = createClient();
      const flow = makeSaveFlow({ id: 'f-1' });
      vi.spyOn(axiosInstance, 'get').mockResolvedValue({ data: flow });

      const result = await client.loadFlow('f-1');

      expect(axiosInstance.get).toHaveBeenCalledWith('/flows/f-1/load');
      expect(result).toEqual(flow);
    });
  });

  describe('saveFlow', () => {
    it('should call POST /flows/:id/save', async () => {
      const { client, axiosInstance } = createClient();
      const saved = makeSaveFlow();
      vi.spyOn(axiosInstance, 'post').mockResolvedValue({ data: saved });
      const body = { nodes: [], edges: [] };

      await client.saveFlow('f-1', body);

      expect(axiosInstance.post).toHaveBeenCalledWith('/flows/f-1/save', body);
    });
  });



  describe('runFlow', () => {
    it('should call POST /flows/:id/run with async=0 by default', async () => {
      const { client, axiosInstance } = createClient();
      vi.spyOn(axiosInstance, 'post').mockResolvedValue({ data: makeFlow() });

      await client.runFlow('f-1');

      expect(axiosInstance.post).toHaveBeenCalledWith('/flows/f-1/run', {}, { params: { async: '0' } });
    });

    it('should pass config in body', async () => {
      const { client, axiosInstance } = createClient();
      vi.spyOn(axiosInstance, 'post').mockResolvedValue({ data: makeFlow() });
      const body = { config: { key: 'value' } };

      await client.runFlow('f-1', body);

      expect(axiosInstance.post).toHaveBeenCalledWith('/flows/f-1/run', body, { params: { async: '0' } });
    });

    it('should send async=1 when opts.async is true', async () => {
      const { client, axiosInstance } = createClient();
      vi.spyOn(axiosInstance, 'post').mockResolvedValue({ data: makeFlow() });

      await client.runFlow('f-1', undefined, { async: true });

      expect(axiosInstance.post).toHaveBeenCalledWith('/flows/f-1/run', {}, { params: { async: '1' } });
    });
  });

  describe('runNode', () => {
    it('should send propagate=1 when true', async () => {
      const { client, axiosInstance } = createClient();
      vi.spyOn(axiosInstance, 'post').mockResolvedValue({ data: makeNodeView() });

      await client.runNode('n-1', { propagate: true });

      expect(axiosInstance.post).toHaveBeenCalledWith(
        '/nodes/n-1/run',
        {},
        { params: { async: '0', propagate: '1' } },
      );
    });

    it('should send propagate=0 when false', async () => {
      const { client, axiosInstance } = createClient();
      vi.spyOn(axiosInstance, 'post').mockResolvedValue({ data: makeNodeView() });

      await client.runNode('n-1', { propagate: false });

      expect(axiosInstance.post).toHaveBeenCalledWith(
        '/nodes/n-1/run',
        {},
        { params: { async: '0', propagate: '0' } },
      );
    });

    it('should send config in body when provided', async () => {
      const { client, axiosInstance } = createClient();
      vi.spyOn(axiosInstance, 'post').mockResolvedValue({ data: makeNodeView() });

      await client.runNode('n-1', { config: { k: 'v' } });

      expect(axiosInstance.post).toHaveBeenCalledWith(
        '/nodes/n-1/run',
        { config: { k: 'v' } },
        expect.any(Object),
      );
    });
  });

  describe('getPortData', () => {
    it('should encode port ref as nodeId:portId@direction', async () => {
      const { client, axiosInstance } = createClient();
      vi.spyOn(axiosInstance, 'get').mockResolvedValue({ data: makePortData() });

      await client.getPortData('node-1', 'out', 'out');

      const expectedRef = encodeURIComponent('node-1:out@out');
      expect(axiosInstance.get).toHaveBeenCalledWith(`/nodes/${expectedRef}/port`);
    });
  });

  describe('listBlocks', () => {
    it('should call GET /blocks/0/list with cores=1 and limit=-1', async () => {
      const { client, axiosInstance } = createClient();
      const data = makeListResult([makeBlock()]);
      vi.spyOn(axiosInstance, 'get').mockResolvedValue({ data });

      await client.listBlocks();

      expect(axiosInstance.get).toHaveBeenCalledWith('/blocks/0/list', {
        params: { cores: '1', limit: '-1' },
      });
    });

    it('should return cached data within TTL', async () => {
      const { client, axiosInstance } = createClient();
      const data = makeListResult([makeBlock()]);
      const spy = vi.spyOn(axiosInstance, 'get').mockResolvedValue({ data });

      await client.listBlocks();
      await client.listBlocks();

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should re-fetch after TTL expires', async () => {
      vi.useFakeTimers();
      const { client, axiosInstance } = createClient();
      const data = makeListResult([makeBlock()]);
      const spy = vi.spyOn(axiosInstance, 'get').mockResolvedValue({ data });

      await client.listBlocks();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1); // past 5-min TTL
      await client.listBlocks();

      expect(spy).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('should bypass cache when forceRefresh is true', async () => {
      const { client, axiosInstance } = createClient();
      const data = makeListResult([makeBlock()]);
      const spy = vi.spyOn(axiosInstance, 'get').mockResolvedValue({ data });

      await client.listBlocks();
      await client.listBlocks(true);

      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('error normalization', () => {
    // Access private normalizeError via bracket notation
    const callNormalize = (client: FlowApiClient, axiosError: Record<string, unknown>): FlowApiError =>
      (client as unknown as { normalizeError: (e: unknown) => FlowApiError }).normalizeError(axiosError);

    const createAxiosError = (
      overrides: { code?: string; status?: number; data?: unknown; message?: string } = {},
    ) => ({
      isAxiosError: true,
      code: overrides.code,
      message: overrides.message ?? 'Request failed',
      response: overrides.status
        ? { status: overrides.status, data: overrides.data ?? {} }
        : undefined,
      config: {},
    });

    it('should normalize ECONNABORTED to timeout error', () => {
      const { client } = createClient();
      const err = callNormalize(client, createAxiosError({ code: 'ECONNABORTED' }));

      expect(err).toBeInstanceOf(FlowApiError);
      expect(err.code).toBe('timeout');
      expect(err.message).toContain('timed out');
    });

    it('should normalize message containing timeout', () => {
      const { client } = createClient();
      const err = callNormalize(client, createAxiosError({ message: 'timeout of 30000ms exceeded' }));

      expect(err.code).toBe('timeout');
    });

    it('should normalize 401 to auth error', () => {
      const { client } = createClient();
      const err = callNormalize(client, createAxiosError({ status: 401, data: { message: 'Unauthorized' } }));

      expect(err.code).toBe('auth');
      expect(err.message).toContain('401');
    });

    it('should normalize 403 to auth error', () => {
      const { client } = createClient();
      const err = callNormalize(client, createAxiosError({ status: 403, data: { message: 'Forbidden' } }));

      expect(err.code).toBe('auth');
      expect(err.message).toContain('403');
    });

    it('should normalize 404 to not_found error', () => {
      const { client } = createClient();
      const err = callNormalize(client, createAxiosError({ status: 404, data: { message: 'Flow not found' } }));

      expect(err.code).toBe('not_found');
      expect(err.message).toContain('Flow not found');
    });

    it('should normalize 500 to api error', () => {
      const { client } = createClient();
      const err = callNormalize(client, createAxiosError({ status: 500, data: { error: 'Internal error' } }));

      expect(err.code).toBe('api');
      expect(err.message).toContain('500');
    });

    it('should normalize network error with no response', () => {
      const { client } = createClient();
      const err = callNormalize(client, createAxiosError({ message: 'Network Error' }));

      expect(err).toBeInstanceOf(FlowApiError);
      expect(err.code).toBe('api');
      expect(err.message).toContain('network');
    });

    it('should prefer body.message over body.error over error.message', () => {
      const { client } = createClient();
      const err = callNormalize(client, createAxiosError({
        status: 500,
        data: { message: 'body-message', error: 'body-error' },
        message: 'axios-message',
      }));

      expect(err.message).toContain('body-message');
      expect(err.message).not.toContain('body-error');
    });

    it('should include timeout value in timeout error message', () => {
      const { client } = createClient({ FLOW_API_TIMEOUT: 15000 });
      const err = callNormalize(client, createAxiosError({ code: 'ECONNABORTED' }));

      expect(err.message).toContain('15000ms');
    });
  });

  describe('FlowApiError', () => {
    it('should have correct name, code, and message', () => {
      const err = new FlowApiError('auth', 'test message');

      expect(err.name).toBe('FlowApiError');
      expect(err.code).toBe('auth');
      expect(err.message).toBe('test message');
      expect(err).toBeInstanceOf(Error);
    });
  });
});
