import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// global-setup.ts mocks the logger for every suite; this one tests the real implementation.
vi.unmock('../../src/logger');
const { logger } = await import('../../src/logger');

describe('logger', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  const lines = () => writeSpy.mock.calls.map(c => String(c[0]));

  it('silences debug at the default level (info)', () => {
    delete process.env.LOG_LEVEL;
    logger.debug('hidden');
    logger.info('shown');

    expect(lines().some(l => l.includes('hidden'))).toBe(false);
    expect(lines().some(l => l.includes('[INFO] shown'))).toBe(true);
  });

  it('emits debug when LOG_LEVEL=debug', () => {
    vi.stubEnv('LOG_LEVEL', 'debug');
    logger.debug('now visible');

    expect(lines().some(l => l.includes('[DEBUG] now visible'))).toBe(true);
  });

  it('suppresses below-threshold levels when LOG_LEVEL=error', () => {
    vi.stubEnv('LOG_LEVEL', 'error');
    logger.warn('warn-hidden');
    logger.error('err-shown');

    expect(lines().some(l => l.includes('warn-hidden'))).toBe(false);
    expect(lines().some(l => l.includes('[ERROR] err-shown'))).toBe(true);
  });

  it('falls back to info for an unknown LOG_LEVEL value', () => {
    vi.stubEnv('LOG_LEVEL', 'bogus');
    logger.debug('hidden');
    logger.info('shown');

    expect(lines().some(l => l.includes('hidden'))).toBe(false);
    expect(lines().some(l => l.includes('shown'))).toBe(true);
  });

  it('renders an Error argument as its message', () => {
    vi.stubEnv('LOG_LEVEL', 'debug');
    logger.error('ctx', new Error('boom'));

    expect(lines().some(l => l.includes('ctx boom'))).toBe(true);
  });
});
