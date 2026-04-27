import WebSocket from 'ws';
import { logger } from './logger';
import type { FlowApiConfig } from './config';
import type { FlowApiClient } from './api-client';
import type { WsEnvelope, FlowEvent } from './types';
import { TERMINAL_STATES } from './types';

interface WaitForCompletionParams {
  flowId: string;
  expectedNodeIds: string[];
  triggerRun: () => Promise<void>;
  timeout?: number;
}

/** Parse WS envelope → FlowEvent, handling both wrapped and direct patterns */
const parseEvent = (raw: string): FlowEvent | null => {
  try {
    const envelope: WsEnvelope = JSON.parse(raw);
    if (envelope.action === 'trace') return null;

    const outer = envelope.data;
    if (!outer) return null;

    // Pattern A: service-wrapped { data: { type, id, flowId, ... } }
    const inner = outer.data as Record<string, unknown> | undefined;
    if (inner && typeof inner.type === 'string') {
      return inner as unknown as FlowEvent;
    }

    // Pattern B: direct { type, id, flowId, ... }
    if (typeof outer.type === 'string') {
      return outer as unknown as FlowEvent;
    }

    return null;
  } catch {
    return null;
  }
};

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

/** Connect to WS, trigger run, wait for all expected nodes to reach terminal state */
export const executeWithWs = (
  apiConfig: FlowApiConfig,
  client: FlowApiClient,
  params: WaitForCompletionParams,
): Promise<{ nodeStates: Map<string, string>; timedOut: boolean }> => {
  const { flowId, expectedNodeIds, triggerRun, timeout = 60_000 } = params;
  const wsUrl = apiConfig.FLOW_WS_URL;

  if (!wsUrl) {
    return Promise.reject(new Error('FLOW_WS_URL not configured'));
  }

  return new Promise((resolve, reject) => {
    const nodeStates = new Map<string, string>();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
    };

    const settle = (timedOut: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ nodeStates, timedOut });
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const checkCompletion = () => {
      if (expectedNodeIds.length === 0) return;
      const allTerminal = expectedNodeIds.every((id) => {
        const state = nodeStates.get(id);
        return state && TERMINAL_STATES.has(state);
      });
      if (allTerminal) settle(false);
    };

    const url = `${wsUrl}?x-api-key=${encodeURIComponent(apiConfig.FLOW_API_KEY)}&channels=0000`;
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
      const event = parseEvent(String(data));
      if (!event || event.type !== 'node') return;
      if (event.flowId !== flowId) return;

      nodeStates.set(event.id, event.state);
      logger.debug(`Node ${event.id}: ${event.state}`);
      checkCompletion();
    });

    ws.on('open', async () => {
      logger.debug(`WebSocket connected for flow ${flowId}`);

      try {
        // Trigger the run
        await triggerRun();
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      // [Eng 1B] Belt-and-suspenders — check if already done (non-fatal if this fails)
      try {
        const snapshot = await checkNodeStatesViaApi(client, flowId, expectedNodeIds);
        if (snapshot) {
          for (const [id, state] of snapshot) {
            nodeStates.set(id, state);
          }
          checkCompletion();
        }
      } catch {
        // Non-fatal: WS monitoring continues even if API check fails
        logger.debug('Belt-and-suspenders check failed, continuing with WS monitoring');
      }
    });

    timer = setTimeout(() => settle(true), timeout);
  });
};

/** Check if WS is available in config */
export const isWsConfigured = (config: FlowApiConfig): boolean =>
  !!config.FLOW_WS_URL;
