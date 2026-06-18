import * as z from 'zod/v4';
import dotenv from 'dotenv';
import { logger } from './logger';

export const DEFAULT_WS_URL = 'wss://wss.eureka.codes/wss-v1';

const configSchema = z.object({
    FLOW_API_URL: z.url().default('https://api.eureka.codes/flw-v1').describe('Eureka Flows API base URL'),
    FLOW_API_KEY: z
        .optional(z.string().trim().min(1))
        .describe('API key for authentication (optional — the auth tool can mint one via browser login)'),
    FLOW_API_TIMEOUT: z.optional(z.coerce.number()).default(30000),
    FLOW_WS_URL: z
        .optional(z.string())
        .transform(v => v?.trim() || DEFAULT_WS_URL)
        .describe('WebSocket endpoint'),
});

export type FlowApiConfig = z.infer<typeof configSchema>;

let cached: FlowApiConfig | null | undefined;

export const getConfig = (): FlowApiConfig | null => {
    if (cached !== undefined) return cached;
    dotenv.config();
    const result = z.safeParse(configSchema, process.env);
    if (!result.success) {
        logger.error('Config validation failed:', z.prettifyError(result.error));
        cached = null;
        return null;
    }
    cached = result.data;
    return cached;
};

export const getConfigOrThrow = (): FlowApiConfig => {
    const config = getConfig();
    if (!config) {
        throw new Error(
            'Invalid flow-mcp configuration (check FLOW_API_URL / FLOW_API_TIMEOUT). ' +
                'FLOW_API_KEY is optional — if unset, ask the assistant to log in (the auth tool opens a browser) ' +
                'or get a key at https://flow.eureka.codes → sign in with Google → Create Key → Copy. ' +
                'Check stderr for validation details.',
        );
    }
    return config;
};
