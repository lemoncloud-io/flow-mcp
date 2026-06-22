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

type ProgressFn = (msg: string, tick?: { current: number; total: number }) => void;

/** Branded loopback callback page — Eureka Flow look (Outfit font, purple gradient mark). */
const PAGE = (opts: { title: string; body: string; tone: 'success' | 'error' }): string => {
    const { title, body, tone } = opts;
    const ok = tone === 'success';
    // This tab is terminal — the assistant does the key polling. Show a static result mark,
    // not a spinner (a perpetual loader on a "you can close this" page reads as stuck).
    const mark = ok
        ? `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`
        : `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#8F19F6"><title>${title} · Eureka Flow</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#fff;--fg:#18181b;--sub:#71717a;--card:#fff;--border:#ececef}
@media(prefers-color-scheme:dark){:root{--bg:#1f1f21;--fg:#f2f2f3;--sub:#a1a1aa;--card:#28282b;--border:#3a3a3e}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
background:var(--bg);color:var(--fg);font-family:Outfit,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.card{width:100%;max-width:380px;text-align:center;background:var(--card);border:1px solid var(--border);
border-radius:20px;padding:40px 32px;box-shadow:0 12px 40px rgba(20,10,40,.12)}
.badge{width:72px;height:72px;margin:0 auto 24px;border-radius:22px;display:flex;align-items:center;justify-content:center;
background:linear-gradient(135deg,#9333ea,#7c3aed);box-shadow:0 8px 24px rgba(124,58,237,.4)}
h1{margin:0 0 8px;font-size:21px;font-weight:700;letter-spacing:-.02em}
p{margin:0;font-size:14.5px;line-height:1.55;color:var(--sub);font-weight:500}
.brand{margin-top:28px;font-size:13px;font-weight:600;color:var(--sub);letter-spacing:.04em}
.brand b{color:#a855f7}
@media(prefers-color-scheme:light){.brand b{color:#8F19F6}}
</style></head>
<body><div class="card"><div class="badge">${mark}</div>
<h1>${title}</h1><p>${body}</p>
<div class="brand"><b>Eureka Flow</b></div></div></body></html>`;
};

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
                    PAGE({
                        tone: 'error',
                        title: 'Sign-in failed',
                        body: 'No authorization code was returned. Close this tab and ask your assistant to log in again.',
                    }),
                );
                rejectCode(new Error('No authorization code returned from the OAuth callback.'));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' }).end(
                PAGE({
                    tone: 'success',
                    title: 'Signed in',
                    body: 'You can close this tab and return to your assistant — it’s finishing setting up your API key.',
                }),
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

/**
 * Reuse an existing valid ec- key, else mint a fresh one (SigV4-signed via webCore).
 * mask=0 is REQUIRED — without it the API returns the key masked (ec-dev-...***), which is unusable.
 */
const mintApiKey = async (webCore: WebCore, openApiEndpoint: string): Promise<string> => {
    try {
        const { data } = await webCore
            .buildSignedRequest({ method: 'GET', baseURL: `${openApiEndpoint}/_keys/0/list` })
            .setParams({ view: 'user', mask: 0 })
            .execute<{ list: KeyView[] }>();
        const valid = data.list?.find(k => !k.invalid && !k.hidden && k.apiKey);
        if (valid?.apiKey) return valid.apiKey;
    } catch {
        // Listing failed — fall through and create a new key.
    }

    try {
        const { data: created } = await webCore
            .buildSignedRequest({ method: 'POST', baseURL: `${openApiEndpoint}/_keys/0` })
            .setParams({ mocks: false, mask: 0 })
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
                onProgress?.('Your key is active.', { current: maxAttempts, total: maxAttempts });
                return true;
            }
        } catch {
            // Network hiccup — retry.
        }
        if (attempt < maxAttempts) {
            onProgress?.(`Activating your key… (${attempt}/${maxAttempts})`, { current: attempt, total: maxAttempts });
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
