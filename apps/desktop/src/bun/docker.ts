/**
 * Docker stack manager — lets the desktop app run `docker compose up -d`
 * et al. on the user's behalf so they never see a terminal.
 *
 * The compose file (`docker-compose.consumer.yml`) ships as an Electrobun
 * asset bundled next to the binary. `getComposeFilePath()` resolves it
 * for both packaged and dev runs — in dev the file lives at the repo
 * root because `bun run build:assets` only fires for packaged builds.
 *
 * All shell-outs use `spawnSync` from `node:child_process` (matches the
 * pattern in `bun/launchers/steam.ts`). These commands are short — a few
 * hundred ms each — so blocking the bun event loop is fine.
 *
 * The `DockerStatus` shape is intentionally a tagged union so the React
 * side can switch on `kind` and render the matching banner copy. The
 * `starting` state is synthetic: when we kick off `up -d`, we record a
 * timestamp and report `starting` for ~60s, after which we let the real
 * `containers_missing` / `running` reading take over.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DockerStatus } from '../shared/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const STARTING_GRACE_MS = 60_000;
// Container we treat as the canary for "the consumer stack is up." Must
// match the `container_name` in docker-compose.consumer.yml.
const CANARY_CONTAINER = 'fglt-api';

let lastStartAt = 0;
let lastError: string | null = null;
// Cached docker binary path so we don't re-probe on every status call.
let dockerBin: string | null = null;

/**
 * Resolve the path to `docker` (or `docker.exe`). Returns null if not
 * installed. We trust the system PATH first; on Windows we fall back to
 * the well-known Docker Desktop install location because Docker Desktop
 * doesn't always update the *current* shell's PATH.
 */
function resolveDocker(): string | null {
	if (dockerBin) return dockerBin;
	const probe = spawnSync(
		process.platform === 'win32' ? 'where' : 'which',
		['docker'],
		{ encoding: 'utf8' },
	);
	if (probe.status === 0) {
		const first = probe.stdout.split(/\r?\n/).find((s) => s.trim().length > 0);
		if (first) {
			dockerBin = first.trim();
			return dockerBin;
		}
	}
	if (process.platform === 'win32') {
		const dd = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
		if (existsSync(dd)) {
			dockerBin = dd;
			return dockerBin;
		}
	}
	return null;
}

/** Run a docker command synchronously, return stdout/stderr/exit. */
function dockerRun(
	args: string[],
	timeoutMs = 30_000,
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
	const bin = resolveDocker();
	if (!bin) {
		return { ok: false, stdout: '', stderr: 'docker not found', status: null };
	}
	const proc = spawnSync(bin, args, { encoding: 'utf8', timeout: timeoutMs });
	return {
		ok: proc.status === 0,
		stdout: proc.stdout ?? '',
		stderr: proc.stderr ?? '',
		status: proc.status,
	};
}

/**
 * Path to the bundled compose file. In packaged Electrobun builds the
 * `build.copy` directive places it under `assets/` relative to the
 * binary; in dev (`bun run desktop`) the bun source runs from
 * `apps/desktop/src/bun/`, so we walk up to the repo root and grab the
 * canonical copy.
 */
export function getComposeFilePath(): string {
	// Packaged: `<binary-dir>/Resources/app/bun/index.js` or similar.
	// We search upward from this file for an `assets/docker-compose.consumer.yml`.
	const packaged = resolve(HERE, '..', 'assets', 'docker-compose.consumer.yml');
	if (existsSync(packaged)) return packaged;
	// Dev fallback: walk to the repo root.
	const repoRoot = resolve(HERE, '..', '..', '..', '..', '..');
	const dev = join(repoRoot, 'docker-compose.consumer.yml');
	if (existsSync(dev)) return dev;
	// Last resort — return the packaged path so error messages name it.
	return packaged;
}

export function dockerStatus(): DockerStatus {
	const bin = resolveDocker();
	if (!bin) return { kind: 'not_installed' };

	// Quick daemon check. `docker version --format ...` exits non-zero
	// (and prints "Cannot connect to the Docker daemon") when the daemon
	// isn't running. Server-side format string forces an actual daemon
	// roundtrip — `docker version` alone reports just the client.
	const v = dockerRun(['version', '--format', '{{.Server.Version}}'], 5_000);
	if (!v.ok) return { kind: 'daemon_down' };

	// Honor the synthetic "starting" window so the UI doesn't flash
	// "stopped" between `up -d` returning and the container actually
	// reaching `Up` state.
	if (lastStartAt > 0 && Date.now() - lastStartAt < STARTING_GRACE_MS) {
		// If it's already running, we can clear the grace early.
		const ps = dockerRun([
			'ps',
			'--filter',
			`name=^${CANARY_CONTAINER}$`,
			'--format',
			'{{.State}}',
		]);
		if (ps.ok && ps.stdout.trim() === 'running') {
			lastStartAt = 0;
			return { kind: 'running' };
		}
		return { kind: 'starting', since: lastStartAt };
	}

	// `docker ps -a --filter name=^fglt-api$ --format {{.State}}` returns
	// empty if the container has never been created, the state name
	// otherwise. -a includes stopped containers.
	const ps = dockerRun([
		'ps',
		'-a',
		'--filter',
		`name=^${CANARY_CONTAINER}$`,
		'--format',
		'{{.State}}',
	]);
	if (!ps.ok) {
		return { kind: 'daemon_down' };
	}
	const state = ps.stdout.trim();
	if (state.length === 0) return { kind: 'containers_missing' };
	if (state === 'running') return { kind: 'running' };
	// "exited", "created", "paused", "dead", "restarting" — all "not
	// usefully running." Lump together as stopped; the UI just offers
	// a Start button.
	return { kind: 'containers_stopped' };
}

export function startBackend(): { ok: boolean; error?: string } {
	const compose = getComposeFilePath();
	if (!existsSync(compose)) {
		const err = `compose file not found: ${compose}`;
		lastError = err;
		return { ok: false, error: err };
	}
	// `compose up -d` is fairly fast (a few seconds for an existing
	// stack; longer on first run when images need pulling). 120s
	// timeout covers cold starts on slow connections.
	const r = dockerRun(['compose', '-f', compose, 'up', '-d'], 120_000);
	if (!r.ok) {
		lastError = (r.stderr || r.stdout || 'unknown docker error').trim();
		return { ok: false, error: lastError };
	}
	lastError = null;
	lastStartAt = Date.now();
	return { ok: true };
}

export function stopBackend(): { ok: boolean; error?: string } {
	const compose = getComposeFilePath();
	const r = dockerRun(['compose', '-f', compose, 'stop'], 60_000);
	if (!r.ok) {
		lastError = (r.stderr || r.stdout || 'unknown docker error').trim();
		return { ok: false, error: lastError };
	}
	lastError = null;
	lastStartAt = 0;
	return { ok: true };
}

/**
 * `docker compose build` (force-rebuild the API image from the bundled
 * source) followed by `up -d --force-recreate` (replace the running
 * containers with ones using the freshly-built image).
 *
 * Triggered by:
 *   - Settings → Backend → "Update backend" button
 *   - Post-app-update auto-rebuild (when the desktop binary version
 *     changes, the bundled source changed too — we rebuild so the API
 *     image keeps pace with the binary).
 *
 * Can take several minutes on slow connections (the build downloads
 * the bun:debian base image + runs `bun install`). Layer caching makes
 * subsequent rebuilds fast (~10s) when only the JS source changed.
 */
export function rebuildBackend(): { ok: boolean; error?: string } {
	const compose = getComposeFilePath();
	const build = dockerRun(['compose', '-f', compose, 'build'], 600_000);
	if (!build.ok) {
		lastError = (build.stderr || build.stdout || 'build failed').trim();
		return { ok: false, error: lastError };
	}
	const up = dockerRun(
		['compose', '-f', compose, 'up', '-d', '--force-recreate'],
		120_000,
	);
	if (!up.ok) {
		lastError = (up.stderr || up.stdout || 'up -d failed').trim();
		return { ok: false, error: lastError };
	}
	lastError = null;
	lastStartAt = Date.now();
	return { ok: true };
}

export function getLastDockerError(): string | null {
	return lastError;
}
