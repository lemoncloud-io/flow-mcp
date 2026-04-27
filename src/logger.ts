/** stderr-based logger — safe to use in stdio MCP servers (won't corrupt JSON-RPC) */

const write = (level: string, ...args: unknown[]) => {
  const msg = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
  process.stderr.write(`[${level}] ${msg}\n`);
};

export const logger = {
  info: (...args: unknown[]) => write('INFO', ...args),
  warn: (...args: unknown[]) => write('WARN', ...args),
  error: (...args: unknown[]) => write('ERROR', ...args),
  debug: (...args: unknown[]) => write('DEBUG', ...args),
};
