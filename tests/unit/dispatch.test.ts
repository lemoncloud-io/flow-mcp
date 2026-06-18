import { describe, it, expect, vi } from 'vitest';
import {
  registerFlowTools,
  registerNodeTools,
  registerBlockTools,
  registerRunTools,
  registerCreditTools,
  registerAuthTools,
  FLOW_READ_ACTIONS,
  FLOW_DO_ACTIONS,
  CREDIT_READ_ACTIONS,
  CREDIT_DO_ACTIONS,
  AUTH_ACTIONS,
} from '../../src/tools';
import { CredentialStore } from '../../src/auth/credentials';
import { makeApiClient, makeConfig } from '../helpers/factories';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowApiClient } from '../../src/api-client';

// Register the granular tools against a fake server to collect their real names.
const collectToolNames = (): string[] => {
  const names: string[] = [];
  const fake = {
    registerTool: (n: string) => {
      names.push(n);
    },
    sendLoggingMessage: vi.fn(),
  } as unknown as McpServer;
  const client = makeApiClient() as unknown as FlowApiClient;
  const config = makeConfig();
  const credentials = new CredentialStore(undefined);
  registerFlowTools(fake, client, config);
  registerNodeTools(fake, client, config);
  registerBlockTools(fake, client);
  registerRunTools(fake, client);
  registerCreditTools(fake, client);
  registerAuthTools(fake, client, credentials, config);
  return names;
};

const ALL_ACTIONS = [
  ...FLOW_READ_ACTIONS,
  ...FLOW_DO_ACTIONS,
  ...CREDIT_READ_ACTIONS,
  ...CREDIT_DO_ACTIONS,
  ...AUTH_ACTIONS,
];

describe('dispatch action lists', () => {
  it('the action lists exactly cover all granular tools (drift guard)', () => {
    const actual = collectToolNames().sort();
    const declared = [...ALL_ACTIONS].sort();
    // Any typo, new tool, or removed tool breaks this.
    expect(declared).toEqual(actual);
  });

  it('the action lists are pairwise disjoint', () => {
    expect(new Set(ALL_ACTIONS).size).toBe(ALL_ACTIONS.length);
  });

  it('splits into 11 flow_read + 13 flow_do + 3 credit_read + 1 credit_do + 3 auth = 31', () => {
    expect(FLOW_READ_ACTIONS.length).toBe(11);
    expect(FLOW_DO_ACTIONS.length).toBe(13);
    expect(CREDIT_READ_ACTIONS.length).toBe(3);
    expect(CREDIT_DO_ACTIONS.length).toBe(1);
    expect(AUTH_ACTIONS.length).toBe(3);
    expect(ALL_ACTIONS.length).toBe(31);
  });

  it('credit lists are exactly the credit actions', () => {
    expect([...CREDIT_READ_ACTIONS, ...CREDIT_DO_ACTIONS].sort()).toEqual([
      'credit_balance',
      'credit_history',
      'credit_packs',
      'credit_purchase',
    ]);
  });

  it('auth list is login/status/logout', () => {
    expect([...AUTH_ACTIONS].sort()).toEqual(['login', 'logout', 'status']);
  });

  it('flow lists contain no credit actions', () => {
    const flowActions = [...FLOW_READ_ACTIONS, ...FLOW_DO_ACTIONS];
    expect(flowActions.filter((a) => a.startsWith('credit_'))).toEqual([]);
  });
});
