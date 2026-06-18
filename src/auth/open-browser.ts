import { spawn } from 'node:child_process';

/**
 * Open a URL in the user's default browser, detached so it never blocks or writes to the MCP
 * stdio channel. Best-effort: rejects only if the launcher process cannot be spawned at all.
 */
export const openBrowser = (url: string): Promise<void> =>
    new Promise((resolve, reject) => {
        const platform = process.platform;
        const [cmd, args] =
            platform === 'darwin'
                ? ['open', [url]]
                : platform === 'win32'
                  ? ['cmd', ['/c', 'start', '', url]]
                  : ['xdg-open', [url]];

        try {
            const child = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' });
            child.on('error', reject);
            child.unref();
            resolve();
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
