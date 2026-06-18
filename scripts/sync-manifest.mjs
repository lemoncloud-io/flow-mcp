#!/usr/bin/env node
// Sync manifest.json "version" with the release version (package.json or CLI arg).
// Skips the semantic-release placeholder so local manifest version stays stable.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliVersion = process.argv[2];
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = cliVersion ?? pkg.version;

const isCleanSemver = /^\d+\.\d+\.\d+$/.test(version);
if (!isCleanSemver) {
    console.log(`sync-manifest: "${version}" is not a clean release version — leaving manifest.json unchanged.`);
    process.exit(0);
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
