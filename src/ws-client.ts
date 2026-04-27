import WebSocket from 'ws';
import { logger } from './logger';
import type { FlowApiConfig } from './config';
import type { FlowApiClient } from './api-client';
import { TERMINAL_STATES } from './types';

interface WaitForCompletionParams {
  flowId: string;
  expectedNodeIds: string[];
  triggerRun: (connectionId: string) => Promise<void>;
  timeout?: number;
}

/** Check if all expected nodes are terminal via API snapshot */
export const checkNodeStatesViaApi = async (
  client: FlowApiClient,
  flowId: string,
  expectedNodeIds: string[],
): Promise<Map<string, string> | null> => {
  const flow = await client.loadFlow(flowId);
  const states = new Map<string, string>();
  for (const n of flow.nodes ?? []) {
    if (n.id && n.status) states.set(n.id, n.status);
  }
  const allDone = expectedNodeIds.every((id) => {
    const s = states.get(id);
    return s && TERMINAL_STATES.has(s);
  });
  return allDone ? states : null;
};

/**
 * Connect to WS, get connectionId, trigger run, wait for completion.
 *
 * Flow:
 * 1. Connect with `info=` param to get connectionId
 * 2. Pass connectionId to triggerRun (run API uses it for directed messaging)
 * 3. Listen for node events, track expectedNodeIds
 * 4. Resolve when all expected nodes reach terminal state
 */
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
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (quietTimer) clearTimeout(quietTimer);
      try { ws.close(); } catch { /* ignore */ }
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

    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const QUIET_PERIOD = 1_500;

    const resetQuietTimer = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        if (!settled && eventLog.length > 0) settle(false);
      }, QUIET_PERIOD);
    };

    const checkCompletion = () => {
      const allTerminal = expectedNodeIds.every((id) => {
        const state = nodeStates.get(id);
        return state && TERMINAL_STATES.has(state);
      });
      if (allTerminal) { settle(false); return; }
      resetQuietTimer();
    };

    // Connect with info= param to receive connectionId
    const url = `${wsUrl}?x-api-key=${encodeURIComponent(apiConfig.FLOW_API_KEY)}&info=&channels=0000`;
    const ws = new WebSocket(url);

    ws.on('error', (err) => {
      logger.error('WebSocket error:', err);
      fail(new Error(`WebSocket connection failed: ${err.message}`));
    });

    ws.on('close', () => {
      if (!settled) {
        fail(new Error('WebSocket connection closed unexpectedly'));
      }
    });

    ws.on('message', (data) => {
      const raw = String(data);

      // Check for info message (contains connectionId)
      try {
        const msg = JSON.parse(raw);
        if (msg.action === 'info' && msg.data?.connectionId) {
          const connectionId = msg.data.connectionId as string;
          logger.debug(`Got connectionId: ${connectionId}`);
          onConnectionId(connectionId);
          return;
        }
      } catch { /* ignore parse errors */ }

      // Parse all message events (node + node/port)
      try {
        const msg = JSON.parse(raw);
        if (msg.action !== 'message' || !msg.data) return;
        const d = msg.data as Record<string, unknown>;

        // Log raw event data with elapsed time
        eventLog.push({
          elapsed: Date.now() - startTs,
          ...d,
        });

        // Track node states for completion detection
        if (d.type === 'node' && typeof d.id === 'string' && typeof d.state === 'string') {
          nodeStates.set(d.id, d.state);
          logger.debug(`Node ${d.id}: ${d.state} (${d.stage ?? ''})`);
          checkCompletion();
        }
      } catch { /* ignore */ }
    });

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
          for (const [id, state] of snapshot) {
            nodeStates.set(id, state);
          }
          checkCompletion();
        }
      } catch {
        logger.debug('Belt-and-suspenders check failed, continuing with WS monitoring');
      }
    };

    timer = setTimeout(() => settle(true), timeout);
  });
};

/** Check if WS is available in config */
export const isWsConfigured = (config: FlowApiConfig): boolean =>
  !!config.FLOW_WS_URL;
