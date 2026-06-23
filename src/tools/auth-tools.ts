import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowApiClient } from '../api-client';
import type { FlowApiConfig } from '../config';
import type { CredentialStore } from '../auth/credentials';
import { runBrowserLogin } from '../auth/login';
import { mcpLog, toolError, toolResult } from './helpers';
import { PassthroughSchema } from './schemas';

/**
 * Auth tools: log in (browser → mint ec- key → store), check status, log out.
 * Registered as granular tools and exposed through the single `auth` dispatch tool.
 */
export const registerAuthTools = (
    server: McpServer,
    client: FlowApiClient,
    credentials: CredentialStore,
    config: FlowApiConfig,
) => {
    server.registerTool(
        'login',
        {
            title: 'Log In',
            description:
                'Authenticate with Eureka: opens a browser for Google sign-in, then mints and stores an API key. ' +
                'Call this when any tool reports an auth_required error, or when the user asks to log in / connect. ' +
                'A browser window opens on the user’s machine; tell them to complete sign-in there.',
            inputSchema: z.object({}),
            outputSchema: PassthroughSchema,
        },
        async (_args, extra) => {
            try {
                const progressToken = extra._meta?.progressToken;
                // Surface poll progress as both a text log and an MCP progress notification (client loader).
                const onProgress = (msg: string, tick?: { current: number; total: number }) => {
                    mcpLog(server, 'info', msg);
                    if (tick && progressToken !== undefined) {
                        extra
                            .sendNotification({
                                method: 'notifications/progress',
                                params: { progressToken, progress: tick.current, total: tick.total, message: msg },
                            })
                            .catch(() => {});
                    }
                };
                const result = await runBrowserLogin(config, onProgress);
                // Save regardless of activation so a slightly-delayed key is still picked up by later calls.
                credentials.save(result.apiKey, { uid: result.uid, sid: result.sid });
                const message = result.activated
                    ? 'Signed in and ready.'
                    : 'Signed in. Your key is still activating (this can take a minute) — if the next request ' +
                      'fails with auth, just try it again shortly.';
                return toolResult({ message, activated: result.activated, ...credentials.status() });
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'status',
        {
            title: 'Auth Status',
            description:
                'Report whether an API key is configured (env or stored login), and the signed-in user if any.',
            inputSchema: z.object({}),
            outputSchema: PassthroughSchema,
            annotations: { readOnlyHint: true },
        },
        async () => {
            try {
                const status = credentials.status();
                if (!status.authenticated) return toolResult({ authenticated: false });
                try {
                    const profile = await client.getProfile();
                    return toolResult({
                        ...status,
                        uid: profile.uid,
                        sid: profile.sid,
                        hasGeminiApiKey: !!profile.geminiApiKey,
                        hasOpenaiApiKey: !!profile.openaiApiKey,
                    });
                } catch {
                    // Key present but profile fetch failed (e.g. revoked) — still report stored status.
                    return toolResult(status);
                }
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.registerTool(
        'logout',
        {
            title: 'Log Out',
            description: 'Remove the stored login key (no effect on a FLOW_API_KEY set via env).',
            inputSchema: z.object({}),
            outputSchema: PassthroughSchema,
        },
        async () => {
            try {
                credentials.clear();
                // A FLOW_API_KEY from env still authenticates after the stored login is removed.
                return toolResult({ message: 'Logged out — stored login key removed.', ...credentials.status() });
            } catch (e) {
                return toolError(e);
            }
        },
    );
};
