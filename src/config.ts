import * as z from 'zod/v4';
import dotenv from 'dotenv';
import { logger } from './logger';

export const DEFAULT_WS_URL = 'wss://wss.eureka.codes/wss-v1';

const configSchema = z.object({
    FLOW_API_URL: z.url().default('https://api.eureka.codes/flw-v1').describe('Eureka Flows API base URL'),
    FLOW_API_KEY: z.string().min(1).describe('API key for authentication'),
    FLOW_API_TIMEOUT: z.optional(z.coerce.number()).default(30000),
    FLOW_WS_URL: z
        .optional(z.string())
        .transform(v => v || DEFAULT_WS_URL)
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
            'Missing or invalid FLOW_API_KEY. This single key authenticates both flows and credits. ' +
                'Get one free: open https://flow.eureka.codes, sign in with Google, click "Create Key", then Copy ' +
                '(it looks like "ec-..." and is shown only once). ' +
                'Set it as FLOW_API_KEY in your Claude Desktop / MCP client config (or .env). ' +
                'Check stderr for validation details.',
        );
    }
    return config;
};
