import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '../../src/auth/credentials';

const file = join(tmpdir(), 'flow-mcp-cred-test.json');
const store = (envKey?: string) => new CredentialStore(envKey, { filePath: file });

afterEach(() => {
  if (existsSync(file)) rmSync(file);
});

describe('CredentialStore', () => {
  it('returns null when neither env nor stored key exists', () => {
    expect(store().getApiKey()).toBeNull();
    expect(store().status()).toEqual({ authenticated: false, source: null });
  });

  it('uses the env key and reports source=env', () => {
    const s = store('ec-env-key');
    expect(s.getApiKey()).toBe('ec-env-key');
    expect(s.status()).toMatchObject({ authenticated: true, source: 'env' });
  });

  it('saves and reads back a file key with metadata (source=file)', () => {
    const s = store();
    s.save('ec-file-key', { uid: 'u1', sid: 's1' });
    expect(s.getApiKey()).toBe('ec-file-key');
    expect(s.status()).toMatchObject({ authenticated: true, source: 'file', uid: 'u1', sid: 's1' });
  });

  it('persists across instances (file is re-read)', () => {
    store().save('ec-persisted');
    expect(store().getApiKey()).toBe('ec-persisted');
  });

  it('env key takes precedence over a stored file key', () => {
    const s = store('ec-env-wins');
    s.save('ec-file-key');
    expect(s.getApiKey()).toBe('ec-env-wins');
    expect(s.status().source).toBe('env');
  });

  it('clear() removes the stored login', () => {
    const s = store();
    s.save('ec-file-key');
    s.clear();
    expect(s.getApiKey()).toBeNull();
    expect(s.status().authenticated).toBe(false);
  });

  it('masks the key in status', () => {
    expect(store('ec-1234567890').status().keyMasked).toBe('ec-12345…');
  });
});
