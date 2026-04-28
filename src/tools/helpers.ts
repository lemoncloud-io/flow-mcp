import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import type { ProgressEvent } from '../ws-client';
import type { NodeData } from '../types';

export const filterDefined = (obj: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export const toolJson = (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

export const toolError = (error: unknown) => {
    let text: string;
    if (error instanceof Error && 'code' in error) {
        text = `[${(error as Error & { code: string }).code}] ${error.message}`;
    } else if (error instanceof Error) {
        text = error.message;
    } else {
        text = String(error);
    }
    return { isError: true as const, content: [{ type: 'text' as const, text }] };
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
