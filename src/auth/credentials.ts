import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { logger } from '../logger';

const DEFAULT_CRED_FILE = join(homedir(), '.eureka', 'flow-mcp.json');

export interface CredentialStoreOptions {
    /** Override the on-disk credentials path (tests). Defaults to ~/.eureka/flow-mcp.json. */
    filePath?: string;
}

interface StoredCredentials {
    apiKey: string;
    savedAt: string;
    uid?: string;
    sid?: string;
}

export interface AuthStatus {
    authenticated: boolean;
    source: 'env' | 'file' | null;
    keyMasked?: string;
    uid?: string;
    sid?: string;
}

/** Mask a key the way the backend does on read: first 8 chars + ellipsis. */
const maskKey = (key: string): string => (key.length <= 8 ? `${key.slice(0, 3)}…` : `${key.slice(0, 8)}…`);

/**
 * Resolves the Eureka API key from (1) an explicit env value or (2) a key minted by the
 * `auth` tool and persisted to ~/.eureka/flow-mcp.json. Env wins, so an explicitly configured
 * FLOW_API_KEY always takes precedence over a browser login. The stored file is re-read on each
 * getApiKey() so a login performed mid-session is picked up without restarting the server.
 */
export class CredentialStore {
    private readonly file: string;

    constructor(
        private readonly envKey?: string,
        options?: CredentialStoreOptions,
    ) {
        this.file = options?.filePath ?? DEFAULT_CRED_FILE;
    }

    /** Current API key, or null if neither env nor a stored login is present. */
    getApiKey(): string | null {
        if (this.envKey) return this.envKey;
        return this.readStored()?.apiKey ?? null;
    }

    /** Persist a freshly minted key with owner-only permissions. */
    save(apiKey: string, meta?: { uid?: string; sid?: string }): void {
        mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
        const data: StoredCredentials = { apiKey, savedAt: new Date().toISOString(), ...meta };
        writeFileSync(this.file, JSON.stringify(data, null, 2), { mode: 0o600 });
        logger.info(`Saved Eureka credentials to ${this.file}`);
    }

    /** Remove any stored login (does not affect an env-provided key). */
    clear(): void {
        if (existsSync(this.file)) rmSync(this.file);
    }

    /** Auth status for the `auth status` action. */
    status(): AuthStatus {
        if (this.envKey) return { authenticated: true, source: 'env', keyMasked: maskKey(this.envKey) };
        const stored = this.readStored();
        if (stored?.apiKey) {
            return {
                authenticated: true,
                source: 'file',
                keyMasked: maskKey(stored.apiKey),
                uid: stored.uid,
                sid: stored.sid,
            };
        }
        return { authenticated: false, source: null };
    }

    private readStored(): StoredCredentials | null {
        try {
            if (!existsSync(this.file)) return null;
            return JSON.parse(readFileSync(this.file, 'utf8')) as StoredCredentials;
        } catch (e) {
            logger.error(`Failed to read stored credentials: ${(e as Error).message}`);
            return null;
        }
    }
}
