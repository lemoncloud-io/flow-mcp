import { WebCoreFactory } from '@lemoncloud/lemon-web-core';
import type { AWSWebCore } from '@lemoncloud/lemon-web-core';

/**
 * In-memory Storage shim for lemon-web-core. A login is a single short-lived process step — the
 * temporary AWS credentials only need to live long enough to sign the create-key call, after which
 * the durable ec- key is persisted by CredentialStore. Nothing sensitive is written to disk here.
 */
class MemoryStorage {
    private mem = new Map<string, string>();
    getItem(key: string): string | null {
        return this.mem.has(key) ? (this.mem.get(key) as string) : null;
    }
    setItem(key: string, value: string): void {
        this.mem.set(key, String(value));
    }
    removeItem(key: string): void {
        this.mem.delete(key);
    }
    clear(): void {
        this.mem.clear();
    }
    key(index: number): string | null {
        return [...this.mem.keys()][index] ?? null;
    }
    get length(): number {
        return this.mem.size;
    }
}

// Always created with cloud:'aws', so narrow off the AWSWebCore | AzureWebCore union.
export type WebCore = AWSWebCore;

export interface WebCoreOptions {
    project: string;
    oAuthEndpoint: string;
    region: string;
}

/** Build a Node-side lemon-web-core instance (AWS cloud) backed by in-memory storage. */
export const createNodeWebCore = (opts: WebCoreOptions): WebCore =>
    WebCoreFactory.create({
        cloud: 'aws',
        project: opts.project,
        oAuthEndpoint: opts.oAuthEndpoint,
        region: opts.region,
        storage: new MemoryStorage() as unknown as Storage,
    }) as AWSWebCore;
