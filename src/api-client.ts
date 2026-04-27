import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from './logger';
import type { FlowApiConfig } from './config';
import type {
  ListResult,
  FlowView,
  SaveFlowView,
  SaveFlowBody,
  NodeView,
  PortData,
  BlockView,
} from './types';

export class FlowApiClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private timeout: number;
  private blockCache: { data: ListResult<BlockView>; at: number } | null = null;
  private readonly BLOCK_CACHE_TTL = 5 * 60 * 1000; // 5 min

  constructor(config: FlowApiConfig) {
    this.baseUrl = config.FLOW_API_URL.replace(/\/+$/, '');
    const apiPath = resolveApiPath(config.FLOW_API_KEY);
    this.timeout = config.FLOW_API_TIMEOUT;

    this.client = axios.create({
      baseURL: `${this.baseUrl}${apiPath}`,
      timeout: this.timeout,
      headers: {
        'x-api-key': config.FLOW_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    logger.info(`API base: ${this.baseUrl}${apiPath}`);

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const normalized = this.normalizeError(error);
        logger.error(`${normalized.code}: ${normalized.message}`);
        return Promise.reject(normalized);
      },
    );
  }

  // --- Flow operations ---

  async listFlows(params?: { isPublic?: boolean }): Promise<ListResult<FlowView>> {
    if (params?.isPublic) {
      // Public endpoint is outside /_api_ prefix
      const { data } = await this.client.get(`${this.baseUrl}/public/flows`);
      return data;
    }
    const { data } = await this.client.get('/flows');
    return data;
  }

  async loadFlow(id: string): Promise<SaveFlowView> {
    const { data } = await this.client.get(`/flows/${id}/load`);
    return data;
  }

  async createFlow(body: { name: string; description?: string }): Promise<FlowView> {
    const { data } = await this.client.post('/flows/0', body);
    return data;
  }

  async saveFlow(id: string, body: SaveFlowBody): Promise<SaveFlowView> {
    const { data } = await this.client.post(`/flows/${id}/save`, body);
    return data;
  }

  async runFlow(
    id: string,
    body?: { config?: Record<string, string> },
    opts?: { async?: boolean; connection?: string },
  ): Promise<FlowView> {
    const params: Record<string, string> = { async: opts?.async ? '1' : '0' };
    if (opts?.connection) params.connection = opts.connection;
    const { data } = await this.client.post(`/flows/${id}/run`, body ?? {}, { params });
    return data;
  }

  // --- Node operations ---

  async runNode(
    id: string,
    options?: { propagate?: boolean; config?: Record<string, string>; async?: boolean; connection?: string },
  ): Promise<NodeView> {
    const params: Record<string, string> = {
      async: options?.async ? '1' : '0',
      propagate: options?.propagate ? '1' : '0',
    };
    if (options?.connection) params.connection = options.connection;
    const { data } = await this.client.post(
      `/nodes/${id}/run`,
      options?.config ? { config: options.config } : {},
      { params },
    );
    return data;
  }

  async upsertNode(
    nodeId: string,
    flowId: string,
    body: Record<string, unknown>,
  ): Promise<NodeView> {
    const { data } = await this.client.post(
      `/nodes/${nodeId}/upsert`,
      body,
      { params: { flowId } },
    );
    return data;
  }

  async getPortData(
    nodeId: string,
    portId: string,
    direction: string,
  ): Promise<PortData> {
    const portRef = `${nodeId}:${portId}@${direction}`;
    const { data } = await this.client.get(`/nodes/${encodeURIComponent(portRef)}/port`);
    return data;
  }

  // --- Block operations ---

  async listBlocks(forceRefresh = false): Promise<ListResult<BlockView>> {
    if (!forceRefresh && this.blockCache && Date.now() - this.blockCache.at < this.BLOCK_CACHE_TTL) {
      return this.blockCache.data;
    }
    const { data } = await this.client.get('/blocks/0/list', {
      params: { cores: '1', limit: '-1' },
    });
    this.blockCache = { data, at: Date.now() };
    return data;
  }

  // --- Error helpers ---

  private normalizeError(error: AxiosError): FlowApiError {
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return new FlowApiError(
        'timeout',
        `Execution timed out (${this.timeout}ms). The flow may still be running on the server. ` +
          `Use flow_load to check status, or increase FLOW_API_TIMEOUT.`,
      );
    }

    const status = error.response?.status;
    const body = error.response?.data as Record<string, unknown> | undefined;
    const message = String(body?.message ?? body?.error ?? error.message);

    if (status === 401 || status === 403) {
      return new FlowApiError('auth', `Authentication failed (${status}): ${message}. Check your FLOW_API_KEY.`);
    }
    if (status === 404) {
      return new FlowApiError('not_found', `Not found: ${message}`);
    }

    return new FlowApiError('api', `API error (${status ?? 'network'}): ${message}`);
  }
}

/** Resolve API path prefix based on API key format (matches frontend routing logic) */
const resolveApiPath = (apiKey: string): string => {
  if (apiKey.startsWith('ec-')) return '/_api_';
  return '/_apis';
};

export type FlowApiErrorCode = 'auth' | 'not_found' | 'timeout' | 'api';

export class FlowApiError extends Error {
  constructor(
    public readonly code: FlowApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FlowApiError';
  }
}
