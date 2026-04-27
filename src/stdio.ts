#!/usr/bin/env node

// === Layer 1: Suppress all console.* methods ===
const noop = () => {};
for (const method of [
  'log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'dirxml',
  'table', 'count', 'countReset', 'group', 'groupCollapsed', 'groupEnd',
  'time', 'timeEnd', 'timeLog', 'clear',
] as const) {
  (console as unknown as Record<string, unknown>)[method] = noop;
}

// === Layer 2: Intercept stdout.write — only allow JSON-RPC messages ===
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const stderrWrite = process.stderr.write.bind(process.stderr);

process.stdout.write = function (
  chunk: string | Uint8Array,
  ...rest: unknown[]
): boolean {
  const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
  const trimmed = str.trimStart();
  if (trimmed.startsWith('{') && trimmed.includes('"jsonrpc"')) {
    return (originalStdoutWrite as Function)(chunk, ...rest);
  }
  return (stderrWrite as Function)(chunk, ...rest);
} as typeof process.stdout.write;

// === Import server AFTER suppression is in place ===
import('./server.js')
  .then((m) => m.createServer().run())
  .catch((error) => {
    stderrWrite(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });

// === Graceful shutdown ===
const shutdown = () => process.exit(0);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);
process.stdin.on('end', shutdown);
