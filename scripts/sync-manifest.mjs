#!/usr/bin/env node
// Sync manifest.json "version" with the release version (package.json or CLI arg).
// CI passes the clean semver from semantic-release. Locally there's no clean version
// (package.json is the semantic-release placeholder), so derive a descriptive dev
// version from git — otherwise a local `npm run bundle` ships a misleading 0.1.0 .mcpb.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliVersion = process.argv[2];
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Derive a semver-valid dev version from git, e.g. "1.3.0+dev.18.g7aae590" (18 commits past v1.3.0). */
const deriveGitVersion = () => {
    try {
        const desc = execSync('git describe --tags --long --always', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim();
        const m = desc.match(/^v?(\d+\.\d+\.\d+)-(\d+)-g([0-9a-f]+)$/);
        if (!m) return null; // no reachable tag — leave manifest unchanged
        const [, base, distance, sha] = m;
        // On a tagged commit (distance 0) the base IS the release version; otherwise mark it dev.
        return distance === '0' ? base : `${base}+dev.${distance}.g${sha}`;
    } catch {
        return null;
    }
};

let version = cliVersion ?? pkg.version;
const isCleanSemver = /^\d+\.\d+\.\d+$/.test(version);
if (!isCleanSemver) {
    const gitVersion = deriveGitVersion();
    if (!gitVersion) {
        console.log(`sync-manifest: "${version}" is not a clean release version and no git tag — leaving manifest.json unchanged.`);
        process.exit(0);
    }
    version = gitVersion;
}

const manifestPath = join(root, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.version === version) {
    console.log(`sync-manifest: manifest.json already at ${version}.`);
    process.exit(0);
}
manifest.version = version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`sync-manifest: manifest.json version -> ${version}`);
