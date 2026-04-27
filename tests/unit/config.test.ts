import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must use dynamic imports due to module-level cached state
const loadConfig = async () => {
  vi.resetModules();
  return import('../../src/config');
};

describe('getConfig', () => {
  const VALID_ENV = {
    FLOW_API_URL: 'https://api.example.com',
    FLOW_API_KEY: 'test-key-123',
  };

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('FLOW_API_URL', '');
    vi.stubEnv('FLOW_API_KEY', '');
    vi.stubEnv('FLOW_API_TIMEOUT', '');
    vi.stubEnv('FLOW_WS_URL', '');
  });

  it('should return parsed config when env is valid', async () => {
    vi.stubEnv('FLOW_API_URL', VALID_ENV.FLOW_API_URL);
    vi.stubEnv('FLOW_API_KEY', VALID_ENV.FLOW_API_KEY);
    const { getConfig } = await loadConfig();

    const config = getConfig();

    expect(config).not.toBeNull();
    expect(config!.FLOW_API_URL).toBe(VALID_ENV.FLOW_API_URL);
    expect(config!.FLOW_API_KEY).toBe(VALID_ENV.FLOW_API_KEY);
  });

  it('should return null when FLOW_API_URL is missing', async () => {
    vi.stubEnv('FLOW_API_KEY', 'some-key');
    const { getConfig } = await loadConfig();

    expect(getConfig()).toBeNull();
  });

  it('should return null when FLOW_API_URL is invalid URL', async () => {
    vi.stubEnv('FLOW_API_URL', 'not-a-url');
    vi.stubEnv('FLOW_API_KEY', 'some-key');
    const { getConfig } = await loadConfig();

    expect(getConfig()).toBeNull();
  });

  it('should return null when FLOW_API_KEY is missing', async () => {
    vi.stubEnv('FLOW_API_URL', 'https://api.example.com');
    const { getConfig } = await loadConfig();

    expect(getConfig()).toBeNull();
  });

  it('should coerce FLOW_API_TIMEOUT string to number', async () => {
    vi.stubEnv('FLOW_API_URL', VALID_ENV.FLOW_API_URL);
    vi.stubEnv('FLOW_API_KEY', VALID_ENV.FLOW_API_KEY);
    vi.stubEnv('FLOW_API_TIMEOUT', '5000');
    const { getConfig } = await loadConfig();

    expect(getConfig()!.FLOW_API_TIMEOUT).toBe(5000);
  });

  it('should default FLOW_API_TIMEOUT to 30000 when absent', async () => {
    vi.stubEnv('FLOW_API_URL', VALID_ENV.FLOW_API_URL);
    vi.stubEnv('FLOW_API_KEY', VALID_ENV.FLOW_API_KEY);
    delete process.env.FLOW_API_TIMEOUT;
    const { getConfig } = await loadConfig();

    expect(getConfig()!.FLOW_API_TIMEOUT).toBe(30000);
  });

  it('should cache result on subsequent calls', async () => {
    vi.stubEnv('FLOW_API_URL', VALID_ENV.FLOW_API_URL);
    vi.stubEnv('FLOW_API_KEY', VALID_ENV.FLOW_API_KEY);
    const { getConfig } = await loadConfig();

    const first = getConfig();
    const second = getConfig();

    expect(first).toBe(second); // same reference
  });

  it('should include FLOW_WS_URL when provided', async () => {
    vi.stubEnv('FLOW_API_URL', VALID_ENV.FLOW_API_URL);
    vi.stubEnv('FLOW_API_KEY', VALID_ENV.FLOW_API_KEY);
    vi.stubEnv('FLOW_WS_URL', 'wss://ws.example.com');
    const { getConfig } = await loadConfig();

    expect(getConfig()!.FLOW_WS_URL).toBe('wss://ws.example.com');
  });
});

describe('getConfigOrThrow', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('FLOW_API_URL', '');
    vi.stubEnv('FLOW_API_KEY', '');
    vi.stubEnv('FLOW_API_TIMEOUT', '');
    vi.stubEnv('FLOW_WS_URL', '');
  });

  it('should return config when valid', async () => {
    vi.stubEnv('FLOW_API_URL', 'https://api.example.com');
    vi.stubEnv('FLOW_API_KEY', 'key');
    const { getConfigOrThrow } = await loadConfig();

    expect(() => getConfigOrThrow()).not.toThrow();
    expect(getConfigOrThrow().FLOW_API_KEY).toBe('key');
  });

  it('should throw with descriptive message when config invalid', async () => {
    const { getConfigOrThrow } = await loadConfig();

    expect(() => getConfigOrThrow()).toThrow(/FLOW_API_URL/);
    expect(() => getConfigOrThrow()).toThrow(/FLOW_API_KEY/);
  });
});
