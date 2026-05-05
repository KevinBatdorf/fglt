#!/usr/bin/env bun
/**
 * Patch Electrobun's compiled `Socket.ts` in node_modules to start its
 * RPC server on a less-common port. Default is 50000, which collides
 * with anyone running Bun globally (e.g. `bun run dev` from another
 * project) or other dev tools — and the collision crashes the app
 * because Electrobun's port-fallback logic doesn't propagate the new
 * port to the BrowserWindow bridge.
 *
 * Run before `electrobun build`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const TARGETS = [
	join(ROOT, 'node_modules', 'electrobun', 'dist', 'api', 'bun', 'core', 'Socket.ts'),
	join(ROOT, 'node_modules', 'electrobun', 'dist-win-x64', 'api', 'bun', 'core', 'Socket.ts'),
];

// 51289 — chosen from the IANA dynamic/private range (49152-65535) and
// not assigned to any common service. Unlikely to collide with dev tools.
const NEW_PORT = 51289;
const OLD_LITERAL = 'startPort = 50000';
const NEW_LITERAL = `startPort = ${NEW_PORT}`;

let touched = 0;
for (const path of TARGETS) {
	let content: string;
	try {
		content = readFileSync(path, 'utf8');
	} catch {
		console.warn(`  skip ${path} (not found)`);
		continue;
	}
	if (content.includes(NEW_LITERAL)) {
		console.log(`  already patched ${path}`);
		continue;
	}
	if (!content.includes(OLD_LITERAL)) {
		console.error(`  WARN: ${OLD_LITERAL} not found in ${path}`);
		continue;
	}
	writeFileSync(path, content.replace(OLD_LITERAL, NEW_LITERAL));
	console.log(`  patched ${path}: 50000 → ${NEW_PORT}`);
	touched++;
}

console.log(`patch-electrobun: ${touched} file(s) patched`);
