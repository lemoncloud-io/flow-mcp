import WebSocket from 'ws';
import { logger } from './logger';
import type { FlowApiConfig } from './config';
import { FlowApiError } from './api-client';
import type { FlowApiClient } from './api-client';
import { TERMINAL_STATES } from './types';

export interface ProgressEvent {
    completedCount: number;
    totalCount: number;
    nodeId: string;
    state: string;
    elapsed: number;
}

interface WaitForCompletionParams {
    flowId: string;
    expectedNodeIds: string[];
    triggerRun: (connectionId: string) => Promise<void>;
    timeout?: number;
    onProgress?: (event: ProgressEvent) => void;
    /** WS channel to subscribe to (from the flow's load response). Defaults to '0000'. */
    channelId?: string;
}

/** Check if all expected nodes are terminal via API snapshot */
const checkNodeStatesViaApi = async (
    client: FlowApiClient,
    flowId: string,
    expectedNodeIds: string[],
): Promise<Map<string, string> | null> => {
    const flow = await client.loadFlow(flowId);
    const states = new Map<string, string>();
    for (const n of flow.nodes ?? []) {
        if (n.id && n.status) states.set(n.id, n.status);
    }
    const allDone = expectedNodeIds.every(id => {
        const s = states.get(id);
        return s && TERMINAL_STATES.has(s);
    });
    return allDone ? states : null;
};

/** Connect to WS, get connectionId, trigger run, wait for completion */
export const executeWithWs = (
    apiConfig: FlowApiConfig,
    client: FlowApiClient,
    params: WaitForCompletionParams,
): Promise<{
    nodeStates: Map<string, string>;
    timedOut: boolean;
    eventLog: Array<Record<string, unknown>>;
}> => {
    const { flowId, expectedNodeIds, triggerRun, timeout = 60_000 } = params;
    const wsUrl = apiConfig.FLOW_WS_URL;

    if (!wsUrl) {
        return Promise.reject(new Error('FLOW_WS_URL not configured'));
    }

    return new Promise((resolve, reject) => {
        const nodeStates = new Map<string, string>();
        const eventLog: Array<Record<string, unknown>> = [];
        const startTs = Date.now();
        let settled = false;
        let terminalCount = 0;
        // eslint-disable-next-line prefer-const -- reassigned via setTimeout at end of scope
        let timer: ReturnType<typeof setTimeout> | undefined;
        let quietTimer: ReturnType<typeof setTimeout> | undefined;
        const QUIET_PERIOD = 1_500;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            if (quietTimer) clearTimeout(quietTimer);
            try {
                ws.close();
            } catch {
                /* ignore */
            }
        };

        const settle = (timedOut: boolean) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ nodeStates, timedOut, eventLog });
        };

        const fail = (err: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        };

        const resetQuietTimer = () => {
            if (quietTimer) clearTimeout(quietTimer);
            quietTimer = setTimeout(async () => {
                if (settled || eventLog.length === 0) return;
                // WS went quiet — the backend may not emit a terminal event for every node, so confirm
                // real state via API before settling. A stalled (non-terminal) node must NOT be reported
                // as completed: keep polling until all terminal or the main timeout fires.
                try {
                    const snapshot = await checkNodeStatesViaApi(client, flowId, expectedNodeIds);
                    if (snapshot) {
                        for (const [id, state] of snapshot) nodeStates.set(id, state);
                        settle(false);
                        return;
                    }
                } catch (err) {
                    logger.debug('Quiet-period API check failed, retrying next period:', err);
                }
                if (!settled) resetQuietTimer();
            }, QUIET_PERIOD);
        };

        const checkCompletion = () => {
            const allTerminal = expectedNodeIds.every(id => {
                const state = nodeStates.get(id);
                return state && TERMINAL_STATES.has(state);
            });
            if (allTerminal) {
                settle(false);
                return;
            }
            resetQuietTimer();
        };

        const onConnectionId = async (connectionId: string) => {
            try {
                await triggerRun(connectionId);
            } catch (err) {
                fail(err instanceof Error ? err : new Error(String(err)));
                return;
            }

            // Belt-and-suspenders: check if already done
            try {
                const snapshot = await checkNodeStatesViaApi(client, flowId, expectedNodeIds);
                if (snapshot) {
                    for (const [id, state] of snapshot) nodeStates.set(id, state);
                    checkCompletion();
                }
            } catch {
                logger.debug('Belt-and-suspenders check failed, continuing with WS monitoring');
            }
        };

        const apiKey = client.getApiKey();
        if (!apiKey) {
            throw new FlowApiError(
                'auth_required',
                'Not authenticated — log in via the auth tool or set FLOW_API_KEY.',
            );
        }
        // Subscribe to the flow's own channel — the web app uses the channelId from the load response,
        // not a hardcoded value. A flow whose channelId isn't '0000' would otherwise receive no events.
        const channel = params.channelId || '0000';
        const url = `${wsUrl}?x-api-key=${encodeURIComponent(apiKey)}&info=&channels=${encodeURIComponent(channel)}`;
        const ws = new WebSocket(url);

        // The server only hands out a connectionId in response to an explicit info request (this is what
        // the web app's websocket.worker.js does on open). Without it we never get a connectionId, the
        // run is never triggered, and every execution times out with an empty event log.
        ws.on('open', () => {
            try {
                ws.send(JSON.stringify({ type: 'system', action: 'info', data: {} }));
            } catch (err) {
                // Send failures still surface via the error/close handlers; log for diagnosis.
                logger.debug('WS info request send failed:', err);
            }
        });

        ws.on('error', err => {
            const safeMsg = err.message.replace(/x-api-key=[^&]+/, 'x-api-key=***');
            logger.error('WebSocket error:', safeMsg);
            fail(new Error(`WebSocket connection failed: ${safeMsg}`));
        });

        ws.on('close', () => {
            if (settled) return;
            // The socket can close right after the run is triggered but before terminal events arrive.
            // Confirm via API before declaring failure so a completed run isn't reported as an error.
            checkNodeStatesViaApi(client, flowId, expectedNodeIds)
                .then(snapshot => {
                    if (settled) return;
                    if (snapshot) {
                        for (const [id, state] of snapshot) nodeStates.set(id, state);
                        settle(false);
                    } else {
                        fail(new Error('WebSocket connection closed unexpectedly'));
                    }
                })
                .catch(() => {
                    if (!settled) fail(new Error('WebSocket connection closed unexpectedly'));
                });
        });

        ws.on('message', data => {
            try {
                const msg = JSON.parse(String(data));

                // Keep-alive: the server pings; reply with pong so it doesn't drop us mid-run.
                if (msg.action === 'ping') {
                    try {
                        ws.send(JSON.stringify({ type: 'system', action: 'pong', data: { timestamp: Date.now() } }));
                    } catch (err) {
                        logger.debug('WS pong send failed:', err);
                    }
                    return;
                }

                // Mirror websocket.worker.js: readiness is keyed on data.id (always present); connectionId
                // may be null. Trigger as soon as the info reply arrives; pass connectionId when present
                // (empty → run without a connection param, events still arrive via the channel sub).
                if (msg.action === 'info' && msg.data?.id) {
                    const conn = typeof msg.data.connectionId === 'string' ? msg.data.connectionId : '';
                    logger.debug(`Info reply id=${msg.data.id}, connectionId=${conn || '(none)'}`);
                    onConnectionId(conn);
                    return;
                }

                if (msg.action !== 'message' || !msg.data) return;
                const d = msg.data as Record<string, unknown>;

                eventLog.push({ elapsed: Date.now() - startTs, ...d });

                if (d.type === 'node' && typeof d.id === 'string' && typeof d.state === 'string') {
                    const prevState = nodeStates.get(d.id);
                    nodeStates.set(d.id, d.state);
                    if (TERMINAL_STATES.has(d.state) && (!prevState || !TERMINAL_STATES.has(prevState))) {
                        terminalCount++;
                    }
                    logger.debug(`Node ${d.id}: ${d.state} (${d.stage ?? ''})`);
                    params.onProgress?.({
                        completedCount: terminalCount,
                        totalCount: expectedNodeIds.length,
                        nodeId: d.id,
                        state: d.state,
                        elapsed: Date.now() - startTs,
                    });
                    checkCompletion();
                }
            } catch (err) {
                logger.debug('WS message parse failed, ignoring frame:', err);
            }
        });

        timer = setTimeout(() => settle(true), timeout);
    });
};

/** Check if WS is available in config */
export const isWsConfigured = (config: FlowApiConfig): boolean => !!config.FLOW_WS_URL;
