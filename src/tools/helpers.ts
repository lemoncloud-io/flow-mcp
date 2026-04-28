import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import type { ProgressEvent } from '../ws-client';
import type { NodeData } from '../types';

export const filterDefined = (obj: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/** Return both human-readable text and structured content for tools with outputSchema */
export const toolResult = (data: object) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
});

export const toolError = (error: unknown) => {
    const code = error instanceof Error && 'code' in error ? (error as Error & { code: string }).code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const text = code ? `[${code}] ${message}` : message;
    return {
        isError: true as const,
        content: [{ type: 'text' as const, text }],
        structuredContent: { error: message, ...(code && { code }) },
    };
};

/** Extract portable node fields, stripping runtime state */
export const stripNodeRuntime = (nodes: NodeData[]) =>
    nodes.map(n => ({ type: n.type, position: n.position, config: n.config, customLabel: n.customLabel }));

/** Build onProgress callback from MCP extra context */
export const makeProgressHandler = (extra: {
    _meta?: { progressToken?: string | number };
    sendNotification: (n: ServerNotification) => Promise<void>;
}): ((evt: ProgressEvent) => void) | undefined => {
    const progressToken = extra._meta?.progressToken;
    if (progressToken === undefined) return undefined;
    return (evt: ProgressEvent) => {
        extra
            .sendNotification({
                method: 'notifications/progress',
                params: {
                    progressToken,
                    progress: evt.completedCount,
                    total: evt.totalCount,
                    message: `Node ${evt.nodeId}: ${evt.state} (${evt.elapsed}ms)`,
                },
            })
            .catch(() => {});
    };
};

/** Send a log message to the MCP client */
export const mcpLog = (server: McpServer, level: 'info' | 'warning' | 'error' | 'debug', data: string) => {
    server.sendLoggingMessage({ level, data, logger: 'flow-mcp' }).catch(() => {});
};
