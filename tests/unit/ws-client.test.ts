import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FlowApiClient } from '../../src/api-client';
import { makeConfig } from '../helpers/factories';

interface MockWebSocket {
  handlers: Record<string, Array<(...args: unknown[]) => void>>;
  sent: string[];
  url: string;
  on(event: string, cb: (...args: unknown[]) => void): MockWebSocket;
  send(data: string): void;
  close(): void;
  emit(event: string, ...args: unknown[]): void;
}

// Class + registry live inside vi.hoisted so the hoisted vi.mock factory can reference them.
const { instances, MockSocket } = vi.hoisted(() => {
  const instances: MockWebSocket[] = [];
  class MockSocket {
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    sent: string[] = [];
    url: string;
    constructor(url: string) {
      this.url = url;
      instances.push(this as unknown as MockWebSocket);
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      (this.handlers[event] ??= []).push(cb);
      return this;
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {}
    emit(event: string, ...args: unknown[]) {
      (this.handlers[event] ?? []).forEach(cb => cb(...args));
    }
  }
  return { instances, MockSocket };
});

vi.mock('ws', () => ({ default: MockSocket }));

import { executeWithWs, isWsConfigured } from '../../src/ws-client';

const flushMicrotasks = () => new Promise(r => setTimeout(r, 0));

// A node-state snapshot as loadFlow would return it.
const flowWith = (states: Record<string, string>) => ({
  nodes: Object.entries(states).map(([id, status]) => ({ id, status })),
});

const makeClient = (overrides?: Partial<FlowApiClient>) =>
  ({
    getApiKey: () => 'ec-test-key',
    loadFlow: vi.fn().mockResolvedValue(flowWith({})),
    ...overrides,
  }) as unknown as FlowApiClient;

const wsConfig = makeConfig({ FLOW_WS_URL: 'wss://ws.test/wss' });

// Drive a socket from open → info reply (so the run is triggered) and return it.
const openAndInfo = async (triggerRun = vi.fn().mockResolvedValue(undefined)) => {
  const ws = instances[instances.length - 1];
  ws.emit('open');
  ws.emit('message', JSON.stringify({ action: 'info', data: { id: 'sock-1', connectionId: 'c-1' } }));
  await flushMicrotasks();
  return { ws, triggerRun };
};

describe('isWsConfigured', () => {
  it('is true when FLOW_WS_URL is set', () => {
    expect(isWsConfigured(makeConfig({ FLOW_WS_URL: 'wss://x' }))).toBe(true);
  });

  it('is false when FLOW_WS_URL is empty', () => {
    expect(isWsConfigured(makeConfig({ FLOW_WS_URL: '' }))).toBe(false);
  });
});

describe('executeWithWs', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('rejects when FLOW_WS_URL is not configured', async () => {
    await expect(
      executeWithWs(makeConfig({ FLOW_WS_URL: '' }), makeClient(), {
        flowId: 'f-1',
        expectedNodeIds: ['n-1'],
        triggerRun: vi.fn(),
      }),
    ).rejects.toThrow('FLOW_WS_URL not configured');
  });

  it('rejects with auth_required when no API key is available', async () => {
    await expect(
      executeWithWs(wsConfig, makeClient({ getApiKey: () => null }), {
        flowId: 'f-1',
        expectedNodeIds: ['n-1'],
        triggerRun: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'auth_required' });
  });

  it('sends an info request on open and triggers the run on the info reply', async () => {
    const triggerRun = vi.fn().mockResolvedValue(undefined);
    const client = makeClient();
    const promise = executeWithWs(wsConfig, client, {
      flowId: 'f-1',
      expectedNodeIds: ['n-1'],
      triggerRun,
    });

    await openAndInfo();

    const ws = instances[0];
    expect(JSON.parse(ws.sent[0])).toMatchObject({ action: 'info' });
    expect(triggerRun).toHaveBeenCalledWith('c-1');

    // Settle so the promise doesn't dangle.
    ws.emit('message', JSON.stringify({ action: 'message', data: { type: 'node', id: 'n-1', state: 'COMPLETED' } }));
    await promise;
  });

  it('resolves when all expected nodes reach a terminal state via WS events', async () => {
    const triggerRun = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();
    const promise = executeWithWs(wsConfig, makeClient(), {
      flowId: 'f-1',
      expectedNodeIds: ['n-1'],
      triggerRun,
      onProgress,
    });

    await openAndInfo();
    const ws = instances[0];
    ws.emit('message', JSON.stringify({ action: 'message', data: { type: 'node', id: 'n-1', state: 'COMPLETED' } }));

    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(result.nodeStates.get('n-1')).toBe('COMPLETED');
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'n-1', state: 'COMPLETED' }));
  });

  it('replies to ping with pong', async () => {
    const promise = executeWithWs(wsConfig, makeClient(), {
      flowId: 'f-1',
      expectedNodeIds: ['n-1'],
      triggerRun: vi.fn().mockResolvedValue(undefined),
    });

    await openAndInfo();
    const ws = instances[0];
    ws.emit('message', JSON.stringify({ action: 'ping' }));

    expect(ws.sent.some(s => JSON.parse(s).action === 'pong')).toBe(true);

    ws.emit('message', JSON.stringify({ action: 'message', data: { type: 'node', id: 'n-1', state: 'COMPLETED' } }));
    await promise;
  });

  it('settles via API snapshot after a quiet period when WS stops emitting', async () => {
    vi.useFakeTimers();
    const loadFlow = vi
      .fn()
      .mockResolvedValueOnce(flowWith({ 'n-1': 'RUNNING' })) // belt-and-suspenders check
      .mockResolvedValue(flowWith({ 'n-1': 'COMPLETED' })); // quiet-period check
    const client = makeClient({ loadFlow });
    const promise = executeWithWs(wsConfig, client, {
      flowId: 'f-1',
      expectedNodeIds: ['n-1'],
      triggerRun: vi.fn().mockResolvedValue(undefined),
    });

    const ws = instances[0];
    ws.emit('open');
    ws.emit('message', JSON.stringify({ action: 'info', data: { id: 'sock-1', connectionId: 'c-1' } }));
    await vi.advanceTimersByTimeAsync(1); // flush belt-and-suspenders
    // A non-terminal node event keeps it waiting and arms the quiet timer.
    ws.emit('message', JSON.stringify({ action: 'message', data: { type: 'node', id: 'n-1', state: 'RUNNING' } }));
    await vi.advanceTimersByTimeAsync(1500); // quiet period elapses → API confirms terminal

    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(result.nodeStates.get('n-1')).toBe('COMPLETED');
    vi.useRealTimers();
  });

  it('settles with timedOut=true when the overall timeout fires', async () => {
    vi.useFakeTimers();
    const promise = executeWithWs(wsConfig, makeClient(), {
      flowId: 'f-1',
      expectedNodeIds: ['n-1'],
      triggerRun: vi.fn().mockResolvedValue(undefined),
      timeout: 5000,
    });

    const ws = instances[0];
    ws.emit('open');
    ws.emit('message', JSON.stringify({ action: 'info', data: { id: 'sock-1', connectionId: 'c-1' } }));
    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result.timedOut).toBe(true);
    vi.useRealTimers();
  });

  it('confirms completion via API when the socket closes after the run finished', async () => {
    const loadFlow = vi
      .fn()
      .mockResolvedValueOnce(flowWith({ 'n-1': 'RUNNING' })) // belt-and-suspenders
      .mockResolvedValue(flowWith({ 'n-1': 'COMPLETED' })); // close-time confirmation
    const promise = executeWithWs(wsConfig, makeClient({ loadFlow }), {
      flowId: 'f-1',
      expectedNodeIds: ['n-1'],
      triggerRun: vi.fn().mockResolvedValue(undefined),
    });

    await openAndInfo();
    const ws = instances[0];
    ws.emit('close');
    await flushMicrotasks();

    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(result.nodeStates.get('n-1')).toBe('COMPLETED');
  });

  it('fails when the socket closes before the run completed', async () => {
    const loadFlow = vi.fn().mockResolvedValue(flowWith({ 'n-1': 'RUNNING' }));
    const promise = executeWithWs(wsConfig, makeClient({ loadFlow }), {
      flowId: 'f-1',
      expectedNodeIds: ['n-1'],
      triggerRun: vi.fn().mockResolvedValue(undefined),
    });

    await openAndInfo();
    instances[0].emit('close');

    await expect(promise).rejects.toThrow('closed unexpectedly');
  });

  it('fails when the socket emits an error', async () => {
    const promise = executeWithWs(wsConfig, makeClient(), {
      flowId: 'f-1',
      expectedNodeIds: ['n-1'],
      triggerRun: vi.fn().mockResolvedValue(undefined),
    });

    instances[0].emit('open');
    instances[0].emit('error', new Error('boom'));

    await expect(promise).rejects.toThrow('WebSocket connection failed');
  });

  it('fails the run when triggerRun throws', async () => {
    const triggerRun = vi.fn().mockRejectedValue(new Error('trigger failed'));
    const promise = executeWithWs(wsConfig, makeClient(), {
      flowId: 'f-1',
      expectedNodeIds: ['n-1'],
      triggerRun,
    });

    const ws = instances[0];
    ws.emit('open');
    ws.emit('message', JSON.stringify({ action: 'info', data: { id: 'sock-1', connectionId: 'c-1' } }));

    await expect(promise).rejects.toThrow('trigger failed');
  });
});
