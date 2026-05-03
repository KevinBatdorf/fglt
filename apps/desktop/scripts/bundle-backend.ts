/**
 * Copies the backend (Dockerfile + source + scripts + migrations + init.sql
 * + package.json + bun.lock) from the repo root into apps/desktop/assets/
 * backend/ so Electrobun's `build.copy` can ship it next to the binary.
 *
 * The bundled compose file references this directory via `build: ./backend`,
 * so on first launch `docker compose up -d` builds the API image locally
 * from the user's machine — no registry needed, no images to publish.
 *
 * Run by `apps/desktop/package.json`'s `build:assets` script. The whole
 * `assets/backend/` directory is gitignored — it's a build artifact.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// scripts/ → apps/desktop/ → apps/ → repo root.
const REPO_ROOT = join(HERE, '..', '..', '..');
const DEST = join(HERE, '..', 'assets', 'backend');

// Explicit allowlist — ensures node_modules / data / .git / desktop client
// never sneak into the bundle. Keep this tight; every entry adds size to
// every shipped binary.
const PATHS = [
	'Dockerfile',
	'.dockerignore',
	'package.json',
	'bun.lock',
	'tsconfig.json',
	'init.sql',
	'src',
	'scripts',
	'migrations',
];

// Skip patterns inside any source dir we copy. Test files don't need
// to ship in the runtime image (and `bun test` would pick the bundled
// copies up as duplicates of the canonical ones at the repo root).
function shouldSkip(src: string): boolean {
	if (src.endsWith('.test.ts')) return true;
	if (src.endsWith('.test.tsx')) return true;
	// _test/ helper subdirs (mock fetchers etc.) only exist for tests.
	if (src.includes(`${'/'}_test${'/'}`)) return true;
	if (src.includes(`${'\\'}_test${'\\'}`)) return true;
	return false;
}

function main() {
	rmSync(DEST, { recursive: true, force: true });
	mkdirSync(DEST, { recursive: true });

	let totalFiles = 0;
	for (const rel of PATHS) {
		const from = join(REPO_ROOT, rel);
		const to = join(DEST, rel);
		if (!existsSync(from)) {
			console.warn(`[bundle-backend] skip (missing): ${rel}`);
			continue;
		}
		cpSync(from, to, {
			recursive: true,
			filter: (s) => !shouldSkip(s),
		});
		totalFiles += 1;
	}
	console.log(
		`[bundle-backend] bundled ${totalFiles} top-level paths → ${DEST}`,
	);
}

main();
