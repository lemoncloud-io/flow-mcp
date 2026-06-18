#!/usr/bin/env node

// Handle --help before suppressing console
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(
        [
            'flow-mcp - MCP server for Eureka Flow visual workflows',
            '',
            'Usage:',
            '  npx @lemoncloud/flow-mcp         Start MCP server (stdio transport)',
            '  flow-mcp --help                   Show this help',
            '',
            'Environment Variables (required):',
            '  FLOW_API_KEY      API key for Eureka Flows API',
            '',
            'Environment Variables (optional):',
            '  FLOW_API_URL      API base URL (default: https://api.eureka.codes/flw-v1)',
            '  FLOW_WS_URL       WebSocket URL for real-time monitoring',
            '  FLOW_API_TIMEOUT  API timeout in ms (default: 30000)',
            '',
            'Configuration:',
            '  Set env vars in your MCP client config or .env file.',
            '  See: https://github.com/lemoncloud-io/flow-mcp#readme',
            '',
        ].join('\n'),
    );
    process.exit(0);
}

// === Layer 1: Suppress stdout-bound console.* methods (keep error/warn on stderr) ===
const noop = () => {};
const consoleObj = console as unknown as Record<string, unknown>;
for (const method of [
    'log',
    'info',
    'debug',
    'trace',
    'dir',
    'dirxml',
    'table',
    'count',
    'countReset',
    'group',
    'groupCollapsed',
    'groupEnd',
    'time',
    'timeEnd',
    'timeLog',
    'clear',
] as const) {
    consoleObj[method] = noop;
}
// error/warn are stderr-bound (safe for stdio MCP) — keep them visible so library errors aren't lost.
const toStderr =
    (prefix: string) =>
    (...args: unknown[]) =>
        process.stderr.write(`${prefix} ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
consoleObj.error = toStderr('[console.error]');
consoleObj.warn = toStderr('[console.warn]');

// === Layer 2: Intercept stdout.write — only allow JSON-RPC messages ===
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const stderrWrite = process.stderr.write.bind(process.stderr);

process.stdout.write = function (chunk: string | Uint8Array, ...rest: unknown[]): boolean {
    const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    const trimmed = str.trimStart();
    if (trimmed.startsWith('{') && trimmed.includes('"jsonrpc"')) {
        return (originalStdoutWrite as Function)(chunk, ...rest);
    }
    return (stderrWrite as Function)(chunk, ...rest);
} as typeof process.stdout.write;

// === Import server AFTER suppression is in place ===
import('./server.js')
    .then(m => m.createServer().run())
    .catch(error => {
        stderrWrite(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    });

// === Graceful shutdown ===
const shutdown = () => process.exit(0);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);
process.stdin.on('end', shutdown);
