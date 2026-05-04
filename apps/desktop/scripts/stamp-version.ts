#!/usr/bin/env bun
/**
 * Stamp the release version into electrobun.config.ts and package.json.
 *
 * Resolves the version from (in priority order):
 *   1. CLI argv:               `bun run stamp:version 0.2.0`
 *   2. $GITHUB_REF_NAME:       `v0.2.0` → `0.2.0` (CI: tag push)
 *   3. fail
 *
 * In-place edit only — no git commit. Used by the release workflow so the
 * Electrobun build emits a manifest whose `version` matches the git tag.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CONFIG = join(ROOT, 'electrobun.config.ts');
const PKG = join(ROOT, 'package.json');

function resolveVersion(): string {
	const argv = process.argv[2]?.trim();
	if (argv) return argv.replace(/^v/, '');

	const ref = process.env.GITHUB_REF_NAME?.trim();
	if (ref) return ref.replace(/^v/, '');

	console.error(
		'stamp-version: no version provided. Pass as argv or set $GITHUB_REF_NAME.',
	);
	process.exit(1);
}

async function stampFile(
	path: string,
	pattern: RegExp,
	replacement: string,
): Promise<void> {
	const src = await readFile(path, 'utf8');
	if (!pattern.test(src)) {
		console.error(`stamp-version: no version field found in ${path}`);
		process.exit(1);
	}
	const next = src.replace(pattern, replacement);
	await writeFile(path, next);
	console.log(`  stamped ${path}`);
}

async function stampConfig(version: string): Promise<void> {
	await stampFile(CONFIG, /version:\s*'[^']+'/, `version: '${version}'`);
}

async function stampPackage(version: string): Promise<void> {
	await stampFile(PKG, /"version":\s*"[^"]+"/, `"version": "${version}"`);
}

const version = resolveVersion();
console.log(`stamp-version: ${version}`);
await stampConfig(version);
await stampPackage(version);
