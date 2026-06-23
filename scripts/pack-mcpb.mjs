#!/usr/bin/env node
// Local .mcpb packer: stamp manifest.json with a git-derived dev version, pack, then restore
// the original file so the working tree stays clean. CI does NOT use this — it stamps the real
// release version via sync-manifest.mjs and packs directly (see .github/workflows/release.yml).
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'manifest.json');
const original = readFileSync(manifestPath, 'utf8');

try {
    execSync('node scripts/sync-manifest.mjs', { cwd: root, stdio: 'inherit' });
    execSync('npx -y @anthropic-ai/mcpb@latest pack . flow-mcp.mcpb', { cwd: root, stdio: 'inherit' });
} finally {
    // Restore the committed manifest exactly — the dev version is a build-time stamp, not a source change.
    writeFileSync(manifestPath, original);
}
