import WebSocket from 'ws';
import {
    emptyExecutionState,
    parseSocketFrame,
    reduceNodeEvent,
    reducePortEvent,
    shouldUpdateState,
} from '@lemoncloud/flow-engine';
import { logger } from './logger';
import type { FlowApiConfig } from './config';
import { FlowApiError } from './api-client';
import type { FlowApiClient } from './api-client';
import { TERMINAL_STATES } from './types';
import type { ExecutionState } from '@lemoncloud/flow-engine';

export interface ProgressEvent {
    completedCount: number;
    totalCount: number;
    nodeId: string;
    state: string;
    elapsed: number;
}

/** An out-port the server reported during a run; its value is fetched over REST afterwards. */
export interface PortUpdate {
    nodeId: string;
    portName: string;
    runId?: string;
}

/** What one frame means for this run, after the engine's ordering rules have had their say. */
interface FrameOutcome {
    exec: ExecutionState;
    /** States to apply, in arrival order. */
    states: Array<{ nodeId: string; state: string }>;
    /** Nodes a new run reset — forget what the previous run left. */
    resets: string[];
    ports: PortUpdate[];
}

// The engine's priority table only covers the states its `NodeState` union models (IDLE→ERROR).
const RANKED_STATES = new Set(['IDLE', 'READY', 'RUNNING', 'COMPLETED', 'ERROR']);

// SKIPPED is terminal for this client (`TERMINAL_STATES`) but absent from that union, so scoring it
// directly would rank it below everything (priority -1) and drop it. Rank it as the terminal state it
// is instead: a late RUNNING frame then cannot walk a skipped node back, while ERROR still wins.
// Anything else unranked keeps the pre-engine last-write behaviour rather than being silently dropped.
const RANK_AS: Record<string, string> = { SKIPPED: 'COMPLETED' };

export const acceptsState = (current: string | undefined, next: string): boolean => {
    if (current === undefined) return true;
    const from = RANK_AS[current] ?? current;
    const to = RANK_AS[next] ?? next;
    if (!RANKED_STATES.has(from) || !RANKED_STATES.has(to)) return true;
    return shouldUpdateState(from, to);
};

/** The state as the server spelled it — kept for states the engine drops (see RANKED_STATES). */
const rawStateOf = (msg: unknown): string | undefined => {
    const data = (msg as { data?: unknown } | null)?.data;
    const raw = data && typeof data === 'object' ? (data as { state?: unknown }).state : undefined;
    return typeof raw === 'string' && raw ? raw : undefined;
};

/**
 * Turn one socket frame into state changes, using the engine's parser and reducers.
 *
 * Ordering (sequence high-water mark, state priority, per-run reset, port-shaped ids) lives in
 * `@lemoncloud/flow-engine` — the browser and the CLI already run these rules, and this client
 * was the last consumer folding frames by last-write-wins.
 */
export const routeFrame = (exec: ExecutionState, msg: unknown, flowId: string): FrameOutcome | null => {
    const frame = parseSocketFrame(msg);
    if (!frame) return null;

    if (frame.kind === 'node') {
        const rawState = rawStateOf(msg);
        const { state, effects } = reduceNodeEvent(exec, frame.event, { currentFlowId: flowId });
        const states: FrameOutcome['states'] = [];
        const resets: string[] = [];
        for (const effect of effects) {
            if (effect.type === 'reset-node') resets.push(effect.nodeId);
            if (effect.type !== 'apply') continue;
            // A port-shaped frame patches its parent, so `effect.nodeId` is the node to move.
            const next = (effect.patch as { state?: string }).state ?? rawState;
            if (next) states.push({ nodeId: effect.nodeId, state: next });
        }
        return { exec: state, states, resets, ports: [] };
    }

    if (frame.kind === 'port') {
        const { state, effects } = reducePortEvent(exec, frame.event, { currentFlowId: flowId });
        // Only out-ports hold a result worth fetching. `direction` rides on the frame, not on the
        // `port-updated` effect, so the pairing has to happen here.
        if (frame.direction !== 'out') return { exec: state, states: [], resets: [], ports: [] };
        const ports: PortUpdate[] = [];
        for (const effect of effects) {
            if (effect.type !== 'port-updated') continue;
            ports.push({ nodeId: effect.nodeId, portName: effect.portName ?? '', runId: effect.runId });
        }
        return { exec: state, states: [], resets: [], ports };
    }

    return { exec, states: [], resets: [], ports: [] };
};

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
    portUpdates: PortUpdate[];
}> => {
    const { flowId, expectedNodeIds, triggerRun, timeout = 60_000 } = params;
    const wsUrl = apiConfig.FLOW_WS_URL;

    if (!wsUrl) {
        return Promise.reject(new Error('FLOW_WS_URL not configured'));
    }

    return new Promise((resolve, reject) => {
        const nodeStates = new Map<string, string>();
        const eventLog: Array<Record<string, unknown>> = [];
        // Keyed by `nodeId:portName` so a port that reports twice resolves once.
        const portUpdates = new Map<string, PortUpdate>();
        const startTs = Date.now();
        let exec = emptyExecutionState();
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
            resolve({ nodeStates, timedOut, eventLog, portUpdates: [...portUpdates.values()] });
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

        /** A new run reused this node — the previous run's terminal state is no longer an answer. */
        const forgetNodeState = (nodeId: string) => {
            const prev = nodeStates.get(nodeId);
            if (prev && TERMINAL_STATES.has(prev)) terminalCount--;
            nodeStates.delete(nodeId);
        };

        const applyNodeState = (nodeId: string, state: string) => {
            const prev = nodeStates.get(nodeId);
            if (!acceptsState(prev, state)) return;
            nodeStates.set(nodeId, state);
            if (TERMINAL_STATES.has(state) && (!prev || !TERMINAL_STATES.has(prev))) terminalCount++;
            logger.debug(`Node ${nodeId}: ${state}`);
            params.onProgress?.({
                completedCount: terminalCount,
                totalCount: expectedNodeIds.length,
                nodeId,
                state,
                elapsed: Date.now() - startTs,
            });
            checkCompletion();
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

                const outcome = routeFrame(exec, msg, flowId);
                if (!outcome) return;
                exec = outcome.exec;
                // A reset can be the whole frame (the new run's state arrives separately), so re-check
                // instead of waiting for the quiet timer to notice.
                for (const nodeId of outcome.resets) forgetNodeState(nodeId);
                if (outcome.resets.length > 0 && outcome.states.length === 0) checkCompletion();
                for (const { nodeId, state } of outcome.states) applyNodeState(nodeId, state);
                for (const port of outcome.ports) portUpdates.set(`${port.nodeId}:${port.portName}`, port);
            } catch (err) {
                logger.debug('WS message parse failed, ignoring frame:', err);
            }
        });

        timer = setTimeout(() => settle(true), timeout);
    });
};

/** Check if WS is available in config */
export const isWsConfigured = (config: FlowApiConfig): boolean => !!config.FLOW_WS_URL;
