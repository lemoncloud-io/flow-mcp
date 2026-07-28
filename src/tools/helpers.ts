import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import type { PortUpdate, ProgressEvent } from '../ws-client';
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

/**
 * Extract portable node fields, stripping runtime state.
 *
 * Everything that decides how a node behaves has to survive a clone or an export: `blockId` (the
 * backend resolves the block from it), `autoExecutionEnabled` and `disabled` (both decide whether a
 * node runs — `flow_run` picks start nodes by `autoExecutionEnabled !== false`), and `description`.
 * Dropping them made a clone execute differently from its original.
 *
 * What stays out is the run: status/state, error, port data and executionStats — the same boundary
 * the engine's `toSnapshot` draws (invariant 4: a run must not make a flow dirty).
 */
export const stripNodeRuntime = (nodes: NodeData[]) =>
    nodes.map(n => ({
        type: n.type,
        blockId: n.blockId,
        position: n.position,
        config: n.config,
        customLabel: n.customLabel,
        description: n.description,
        disabled: n.disabled,
        autoExecutionEnabled: n.autoExecutionEnabled,
    }));

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

/**
 * Resolve the actual output values for the out-ports a run reported. Each `node/port` frame is only
 * a notification (id + runId, no value) — same as the web app, the value is fetched per port via the
 * run-scoped REST /port endpoint. Returns the resolved out-port values so callers get the real
 * result text without a second tool call. Ports that fail to resolve are skipped.
 *
 * The frames are parsed and ordered by the engine (`ws-client.routeFrame`), which hands back the
 * out-ports already deduped — there is no port-id parsing left to do here.
 */
export const resolveOutputs = async (
    client: FlowApiClient,
    flowId: string,
    ports: PortUpdate[],
): Promise<ResolvedOutput[]> => {
    // Ports are independent and already deduped, so they resolve concurrently: a single flaky port
    // would otherwise hold up the rest through its retry backoff (GETs retry up to 3 times, ≤8s).
    const settled = await Promise.all(
        ports.map(async ({ nodeId, portName, runId }): Promise<ResolvedOutput | null> => {
            try {
                const port = await client.getPortData(nodeId, portName, 'out', { flowId, runId });
                if (!port?.data || port.data.value === undefined) return null;
                return { nodeId, port: portName, value: port.data.value, type: port.data.type };
            } catch {
                return null; // port not readable for this run — skip
            }
        }),
    );
    return settled.filter((output): output is ResolvedOutput => output !== null);
};

/** Send a log message to the MCP client */
export const mcpLog = (server: McpServer, level: 'info' | 'warning' | 'error' | 'debug', data: string) => {
    server.sendLoggingMessage({ level, data, logger: 'flow-mcp' }).catch(() => {});
};
