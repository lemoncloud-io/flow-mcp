import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from './logger';
import { CredentialStore } from './auth/credentials';
import type { FlowApiConfig } from './config';
import type {
    ListResult,
    FlowView,
    SaveFlowView,
    SaveFlowBody,
    NodeView,
    PortData,
    BlockView,
    ProfileView,
    RunView,
    WalletView,
    ProductView,
    TransactionView,
} from './types';

export class FlowApiClient {
    private client: AxiosInstance;
    private baseUrl: string;
    private timeout: number;
    private credentials: CredentialStore;
    private blockCache: { data: ListResult<BlockView>; at: number } | null = null;
    private readonly BLOCK_CACHE_TTL = 5 * 60 * 1000; // 5 min

    constructor(config: FlowApiConfig, credentials?: CredentialStore) {
        this.baseUrl = config.FLOW_API_URL.replace(/\/+$/, '');
        // Backend serves the API only under /_api_ (the legacy /_apis route was removed 2026-04-30).
        const apiPath = '/_api_';
        this.timeout = config.FLOW_API_TIMEOUT;
        this.credentials = credentials ?? new CredentialStore(config.FLOW_API_KEY);

        this.client = axios.create({
            baseURL: `${this.baseUrl}${apiPath}`,
            timeout: this.timeout,
            headers: { 'Content-Type': 'application/json' },
        });

        logger.info(`API base: ${this.baseUrl}${apiPath}`);

        // Inject the x-api-key per request so a key minted mid-session (via the auth tool) is used
        // immediately, without restarting the server. No key yet → fail fast with auth_required.
        this.client.interceptors.request.use(requestConfig => {
            const apiKey = this.credentials.getApiKey();
            if (!apiKey) {
                throw new FlowApiError(
                    'auth_required',
                    'Not authenticated. Ask the assistant to log in (the auth tool opens a browser for Google sign-in), ' +
                        'or set FLOW_API_KEY.',
                );
            }
            requestConfig.headers.set('x-api-key', apiKey);
            return requestConfig;
        });

        this.client.interceptors.response.use(
            response => response,
            error => {
                const normalized = this.normalizeError(error);
                logger.error(`${normalized.code}: ${normalized.message}`);
                return Promise.reject(normalized);
            },
        );
    }

    /** Resolved API key (env or browser-login), or null if not yet authenticated. */
    getApiKey(): string | null {
        return this.credentials.getApiKey();
    }

    // --- Flow operations ---

    async getProfile(): Promise<ProfileView> {
        const { data } = await this.client.get('/flows/0/profile');
        return data;
    }

    async listFlows(opts?: {
        isPublic?: boolean;
        limit?: number;
        offset?: number;
        sort?: string;
    }): Promise<ListResult<FlowView>> {
        const params: Record<string, string | number> = {};
        if (opts?.limit !== undefined) params.limit = opts.limit;
        if (opts?.offset !== undefined) params.offset = opts.offset;
        if (opts?.sort) params.sort = opts.sort;

        if (opts?.isPublic) {
            const { data } = await this.client.get(`${this.baseUrl}/public/flows`, { params });
            return data;
        }
        const { data } = await this.client.get('/flows', { params });
        return data;
    }

    async loadFlow(id: string): Promise<SaveFlowView> {
        const { data } = await this.client.get(`/flows/${id}/load`);
        return data;
    }

    async saveFlow(id: string, body: SaveFlowBody): Promise<SaveFlowView> {
        const { data } = await this.client.post(`/flows/${id}/save`, body);
        return data;
    }

    async upsertFlow(id: string, body: Record<string, unknown>): Promise<SaveFlowView> {
        const { data } = await this.client.post(`/flows/${id}/upsert`, body);
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

    // --- Run operations ---

    async listRuns(opts?: { limit?: number; offset?: number }): Promise<ListResult<RunView>> {
        const params: Record<string, number> = {};
        if (opts?.limit !== undefined) params.limit = opts.limit;
        if (opts?.offset !== undefined) params.offset = opts.offset;
        const { data } = await this.client.get('/runs', { params });
        return data;
    }

    async getRun(id: string): Promise<RunView> {
        const { data } = await this.client.get(`/runs/${id}`);
        return data;
    }

    // --- Node operations ---

    async getNode(id: string): Promise<NodeView> {
        const { data } = await this.client.get(`/nodes/${id}`);
        return data;
    }

    async runNode(
        id: string,
        options?: { propagate?: boolean; config?: Record<string, string>; async?: boolean; connection?: string },
    ): Promise<NodeView> {
        const params: Record<string, string> = {
            async: options?.async ? '1' : '0',
            propagate: options?.propagate ? '1' : '0',
        };
        if (options?.connection) params.connection = options.connection;
        const { data } = await this.client.post(`/nodes/${id}/run`, options?.config ? { config: options.config } : {}, {
            params,
        });
        return data;
    }

    async upsertNode(nodeId: string, flowId: string, body: Record<string, unknown>): Promise<NodeView> {
        const { data } = await this.client.post(`/nodes/${nodeId}/upsert`, body, { params: { flowId } });
        return data;
    }

    async getPortData(nodeId: string, portId: string, direction: string): Promise<PortData> {
        const portRef = `${nodeId}:${portId}@${direction}`;
        const { data } = await this.client.get(`/nodes/${encodeURIComponent(portRef)}/port`);
        return data;
    }

    // --- Block operations ---

    async getBlock(id: string): Promise<BlockView> {
        const { data } = await this.client.get(`/blocks/${id}`);
        return data;
    }

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

    // --- Credit / billing operations (flw credit gateway, x-api-key) ---

    async getWalletBalance(): Promise<WalletView> {
        const { data } = await this.client.get('/wallets/0/balance');
        return data;
    }

    async listProducts(): Promise<ListResult<ProductView>> {
        // Public endpoint — bypasses the /_api_ key prefix.
        const { data } = await this.client.get(`${this.baseUrl}/public/products/0/list`, { params: { limit: 100 } });
        return data;
    }

    async purchaseCredits(productId: string, requestId: string): Promise<Record<string, unknown>> {
        const { data } = await this.client.post('/credits/0/purchase', { productId, requestId });
        return data;
    }

    async listTransactions(opts?: {
        stereo?: string;
        limit?: number;
        page?: number;
    }): Promise<ListResult<TransactionView>> {
        const params: Record<string, string | number> = {};
        if (opts?.stereo) params.stereo = opts.stereo;
        if (opts?.limit !== undefined) params.limit = opts.limit;
        if (opts?.page !== undefined) params.page = opts.page;
        const { data } = await this.client.get('/transactions/0/list', { params });
        return data;
    }

    // --- Error helpers ---

    private normalizeError(error: AxiosError): FlowApiError {
        if (
            error.code === 'ECONNABORTED' ||
            error.code === 'ETIMEDOUT' ||
            error.code === 'ERR_CANCELED' ||
            error.message?.includes('timeout')
        ) {
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
        if (status === 402) {
            return new FlowApiError(
                'payment',
                `Payment required (402): ${message}. No card on file — enroll a payment method at ` +
                    `https://billing.eureka.codes before purchasing credits.`,
            );
        }
        if (status === 404) {
            return new FlowApiError('not_found', `Not found: ${message}`);
        }

        return new FlowApiError('api', `API error (${status ?? 'network'}): ${message}`);
    }
}

export type FlowApiErrorCode = 'auth' | 'auth_required' | 'payment' | 'not_found' | 'timeout' | 'api';

export class FlowApiError extends Error {
    constructor(
        public readonly code: FlowApiErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'FlowApiError';
    }
}
