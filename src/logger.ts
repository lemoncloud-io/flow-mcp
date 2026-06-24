/** stderr-based logger — safe to use in stdio MCP servers (won't corrupt JSON-RPC) */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

// Threshold from LOG_LEVEL env (default 'info' — debug is silenced unless explicitly enabled).
// Read per-write so a level set after import (or in tests) takes effect without re-importing.
const threshold = (): number => {
    const raw = (process.env.LOG_LEVEL ?? '').trim().toLowerCase();
    return LEVELS[raw as Level] ?? LEVELS.info;
};

const write = (level: Level, ...args: unknown[]) => {
    if (LEVELS[level] < threshold()) return;
    const msg = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
    process.stderr.write(`[${level.toUpperCase()}] ${msg}\n`);
};

export const logger = {
    info: (...args: unknown[]) => write('info', ...args),
    warn: (...args: unknown[]) => write('warn', ...args),
    error: (...args: unknown[]) => write('error', ...args),
    debug: (...args: unknown[]) => write('debug', ...args),
};
