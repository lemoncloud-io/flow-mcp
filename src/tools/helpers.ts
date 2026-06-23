import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import type { ProgressEvent } from '../ws-client';
import type { FlowApiClient } from '../api-client';
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

/** Build the web console link for a flow: `{base}/flows/{id}`. */
export const flowWebUrl = (base: string, id: string): string => `${base.replace(/\/+$/, '')}/flows/${id}`;

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

export interface ResolvedOutput {
    nodeId: string;
    port: string;
    value: unknown;
    type?: string;
}

/** Parse a WS port id ("nodeId:portName@direction" or "nodeId:portName") into parts. */
const parsePortRef = (id: string): { nodeId: string; portName: string; direction?: string } | null => {
    const at = id.indexOf('@');
    const portId = at !== -1 ? id.slice(0, at) : id;
    const direction = at !== -1 ? id.slice(at + 1) : undefined;
    const colon = portId.indexOf(':');
    if (colon === -1) return null;
    return { nodeId: portId.slice(0, colon), portName: portId.slice(colon + 1), direction };
};

/**
 * Resolve the actual output values from a run's WS event log. Each `node/port` event is only a
 * notification (id + runId, no value) — same as the web app, the value is fetched per port via the
 * run-scoped REST /port endpoint. Returns the resolved out-port values so callers get the real
 * result text without a second tool call. Ports that fail to resolve are skipped.
 */
export const resolveOutputs = async (
    client: FlowApiClient,
    flowId: string,
    eventLog: Array<Record<string, unknown>>,
): Promise<ResolvedOutput[]> => {
    // Keep the latest port event per out-port (later events carry the final value + runId).
    const latest = new Map<string, { nodeId: string; portName: string; runId?: string }>();
    for (const e of eventLog) {
        if (e.type !== 'node/port' || typeof e.id !== 'string') continue;
        const p = parsePortRef(e.id);
        if (!p || p.direction !== 'out') continue;
        latest.set(`${p.nodeId}:${p.portName}`, {
            nodeId: p.nodeId,
            portName: p.portName,
            runId: typeof e.runId === 'string' ? e.runId : undefined,
        });
    }

    const outputs: ResolvedOutput[] = [];
    for (const { nodeId, portName, runId } of latest.values()) {
        try {
            const port = await client.getPortData(nodeId, portName, 'out', { flowId, runId });
            if (port?.data && port.data.value !== undefined) {
                outputs.push({ nodeId, port: portName, value: port.data.value, type: port.data.type });
            }
        } catch {
            /* port not readable for this run — skip */
        }
    }
    return outputs;
};

/** Send a log message to the MCP client */
export const mcpLog = (server: McpServer, level: 'info' | 'warning' | 'error' | 'debug', data: string) => {
    server.sendLoggingMessage({ level, data, logger: 'flow-mcp' }).catch(() => {});
};
