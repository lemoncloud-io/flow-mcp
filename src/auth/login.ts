import http from 'node:http';
import { logger } from '../logger';
import { openBrowser } from './open-browser';
import { createNodeWebCore, type WebCore } from './web-core';
import { resolveAuthEndpoints } from './endpoints';
import type { FlowApiConfig } from '../config';

const LOGIN_TIMEOUT = 300_000;
// A freshly minted key takes a short while to become active on the flows API. Poll until it works.
const ACTIVATION_INTERVAL = 4_000;
const ACTIVATION_MAX_MS = Number(process.env.EUREKA_KEY_ACTIVATION_TIMEOUT_MS) || 180_000;

export interface LoginResult {
    apiKey: string;
    /** Whether the minted key was confirmed active on the flows API before returning. */
    activated: boolean;
    uid?: string;
    sid?: string;
}

interface KeyView {
    id: string;
    apiKey?: string;
    name?: string;
    hidden?: boolean;
    invalid?: boolean;
}

type ProgressFn = (msg: string) => void;

const PAGE = (title: string, body: string): string =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body style="font-family:system-ui;text-align:center;padding:3rem"><h2>${title}</h2><p>${body}</p></body></html>`;

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Extract a concise HTTP status + body from an axios-style error for actionable messages. */
const httpDetail = (e: unknown): string => {
    const err = e as { response?: { status?: number; data?: unknown }; message?: string };
    if (err?.response) return `HTTP ${err.response.status} ${JSON.stringify(err.response.data ?? '').slice(0, 200)}`;
    return err?.message ?? String(e);
};

const buildAuthorizeUrl = (socialOAuthUrl: string, redirectUri: string): string => {
    const state = encodeURIComponent(JSON.stringify({ from: 'flow-mcp' }));
    return `${socialOAuthUrl}/oauth/google/authorize?redirect=${encodeURIComponent(redirectUri)}&state=${state}`;
};

/** Start a single-use loopback server on a random port; resolves the auth code from /cb. */
const startCallbackServer = (): Promise<{ server: http.Server; port: number; code: Promise<string> }> =>
    new Promise((resolve, reject) => {
        let resolveCode: (c: string) => void = () => {};
        let rejectCode: (e: Error) => void = () => {};
        const code = new Promise<string>((res, rej) => {
            resolveCode = res;
            rejectCode = rej;
        });
        const timer = setTimeout(() => rejectCode(new Error('Login timed out after 5 minutes.')), LOGIN_TIMEOUT);

        const server = http.createServer((req, res) => {
            const url = new URL(req.url ?? '', 'http://127.0.0.1');
            if (url.pathname !== '/cb') {
                res.writeHead(404).end();
                return;
            }
            clearTimeout(timer);
            const authCode = url.searchParams.get('code');
            if (!authCode) {
                res.writeHead(400, { 'Content-Type': 'text/html' }).end(
                    PAGE('Sign-in failed', 'No code returned. Try again.'),
                );
                rejectCode(new Error('No authorization code returned from the OAuth callback.'));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' }).end(
                PAGE('Signed in ✓', 'You can close this tab and return to your assistant.'),
            );
            resolveCode(authCode);
        });

        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (addr && typeof addr === 'object') resolve({ server, port: addr.port, code });
            else reject(new Error('Failed to bind the loopback callback server.'));
        });
    });

/** Exchange the authorization code for AWS credentials stored inside the webCore instance. */
const exchangeCodeForCreds = async (webCore: WebCore, oAuthEndpoint: string, code: string): Promise<void> => {
    try {
        const { data } = await webCore
            .buildSignedRequest({ method: 'POST', baseURL: `${oAuthEndpoint}/oauth/google/token` })
            .setBody({ code })
            .execute<{ Token: unknown }>();
        await webCore.buildCredentialsByToken((data as { Token: unknown }).Token as never);
        // The /_keys endpoint requires the x-lemon-identity header (identity token) in addition to the
        // SigV4 signature — enable it so the key-creation request is authorized.
        await webCore.setUseXLemonIdentity(true);
    } catch (e) {
        throw new Error(`OAuth token exchange failed — ${httpDetail(e)}`, { cause: e });
    }
};

/** Reuse an existing valid ec- key, else mint a fresh one (SigV4-signed via webCore). */
const mintApiKey = async (webCore: WebCore, openApiEndpoint: string): Promise<string> => {
    try {
        const { data } = await webCore
            .buildSignedRequest({ method: 'GET', baseURL: `${openApiEndpoint}/_keys/0/list` })
            .setParams({ view: 'user' })
            .execute<{ list: KeyView[] }>();
        const valid = data.list?.find(k => !k.invalid && !k.hidden && k.apiKey);
        if (valid?.apiKey) return valid.apiKey;
    } catch {
        // Listing failed — fall through and create a new key.
    }

    try {
        const { data: created } = await webCore
            .buildSignedRequest({ method: 'POST', baseURL: `${openApiEndpoint}/_keys/0` })
            .setParams({ mocks: false })
            .setBody({ name: 'flow-mcp' })
            .execute<KeyView>();
        if (!created.apiKey) throw new Error('Key creation returned no apiKey.');
        return created.apiKey;
    } catch (e) {
        throw new Error(`API key creation failed — ${httpDetail(e)}`, { cause: e });
    }
};

/**
 * Poll the flows API until the freshly minted key is accepted (HTTP 200). A new key is not valid on
 * the flows API immediately — it propagates within a few minutes. Returns true once active, or false
 * if it never activates within ACTIVATION_MAX_MS (the key is still saved; the next call may succeed).
 */
const pollUntilActive = async (apiUrl: string, apiKey: string, onProgress?: ProgressFn): Promise<boolean> => {
    const url = `${apiUrl.replace(/\/+$/, '')}/_api_/flows/0/profile`;
    const maxAttempts = Math.max(1, Math.ceil(ACTIVATION_MAX_MS / ACTIVATION_INTERVAL));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
            if (res.ok) {
                onProgress?.('Your key is active.');
                return true;
            }
        } catch {
            // Network hiccup — retry.
        }
        if (attempt < maxAttempts) {
            onProgress?.(`Activating your key… (${attempt}/${maxAttempts})`);
            await delay(ACTIVATION_INTERVAL);
        }
    }
    return false;
};

/**
 * Run the full browser-login flow: open a Google sign-in in the browser, capture the code on a
 * loopback callback, exchange it for credentials, and mint a durable ec- API key.
 */
export const runBrowserLogin = async (config: FlowApiConfig, onProgress?: ProgressFn): Promise<LoginResult> => {
    const ep = resolveAuthEndpoints(config);
    const { server, port, code } = await startCallbackServer();
    try {
        const redirectUri = `http://127.0.0.1:${port}/cb`;
        onProgress?.('Opening your browser for Google sign-in…');
        await openBrowser(buildAuthorizeUrl(ep.socialOAuthUrl, redirectUri));
        onProgress?.('Waiting for sign-in to finish (up to 5 minutes)…');

        const authCode = await code;
        onProgress?.('Signed in. Provisioning your API key…');

        const webCore = createNodeWebCore({ project: ep.project, oAuthEndpoint: ep.oAuthEndpoint, region: ep.region });
        await exchangeCodeForCreds(webCore, ep.oAuthEndpoint, authCode);
        const apiKey = await mintApiKey(webCore, ep.openApiEndpoint);
        const activated = await pollUntilActive(ep.apiUrl, apiKey, onProgress);

        logger.info(`Browser login complete; API key minted (activated=${activated}).`);
        return { apiKey, activated };
    } finally {
        server.close();
    }
};
