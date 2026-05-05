#!/usr/bin/env bun
/**
 * Wrap the Electrobun-emitted bundle in an NSIS installer.
 *
 * Pre-conditions: `electrobun build --env=stable` has run, producing
 *   apps/desktop/build/stable-win-x64/FindaGameLikeThat/
 *
 * IMPORTANT: that directory is NOT the runnable app — it's a
 * self-extracting stub. Its `bin/launcher` is actually the extractor
 * binary (424 KB), not the real launcher (310 KB). The real app
 * (real launcher.exe + libNativeWrapper.dll + bun.exe + 100 other
 * files) lives inside `Resources/<hash>.tar.zst`. If you ship the
 * stub directly, double-clicking the installed launcher.exe just
 * prints "Not a valid self-extracting installer" and exits.
 *
 * Steps:
 *   1. Decompress Resources/<hash>.tar.zst (using Electrobun's
 *      bundled zig-zstd) and extract the tar into build/installer-
 *      input/ — this gives us the real, runnable bundle.
 *   2. Run rcedit on launcher.exe (and bun.exe) to embed the app
 *      icon. Electrobun's own embed step is broken because its
 *      compiled CLI hardcodes a dev-only path for rcedit.
 *   3. Invoke makensis with -DBUILD_DIR pointing at the staged
 *      bundle.
 *   4. Drop the resulting installer into apps/desktop/artifacts/.
 *
 * Run with: `bun run build:installer`
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
// @ts-expect-error — rcedit ships JS with no bundled .d.ts on this version
import rcedit from 'rcedit';

const ROOT = join(import.meta.dir, '..');
const BUILD = join(ROOT, 'build', 'stable-win-x64');
const APP_SRC = join(BUILD, 'FindaGameLikeThat');
const APP_RESOURCES = join(APP_SRC, 'Resources');
const STAGING = join(ROOT, 'build', 'installer-input');
const NSI = join(ROOT, 'installer', 'fglt.nsi');
const ICON = join(ROOT, 'assets', 'icon.ico');
const ARTIFACTS = join(ROOT, 'artifacts');
const ZIG_ZSTD = join(
	ROOT,
	'node_modules',
	'electrobun',
	'dist-win-x64',
	'zig-zstd.exe',
);

function fail(msg: string): never {
	console.error(`package-windows: ${msg}`);
	process.exit(1);
}

function which(cmd: string): string | null {
	const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [
		cmd,
	]);
	if (probe.status !== 0) return null;
	return probe.stdout.toString().trim().split(/\r?\n/)[0] || null;
}

async function readVersion(): Promise<string> {
	const pkg = JSON.parse(
		await readFile(join(ROOT, 'package.json'), 'utf8'),
	) as {
		version: string;
	};
	if (!pkg.version) fail('package.json has no version field');
	return pkg.version;
}

function findPayloadTarZst(): string {
	if (!existsSync(APP_RESOURCES))
		fail(
			`expected Electrobun Resources/ at ${APP_RESOURCES} — run \`bun run build\` first`,
		);
	const candidates = readdirSync(APP_RESOURCES).filter((f) =>
		f.endsWith('.tar.zst'),
	);
	if (candidates.length !== 1) {
		fail(
			`expected exactly one .tar.zst under ${APP_RESOURCES}, found ${candidates.length}: ${candidates.join(', ')}`,
		);
	}
	return join(APP_RESOURCES, candidates[0]);
}

function stage(): void {
	const payload = findPayloadTarZst();
	if (!existsSync(ZIG_ZSTD)) fail(`zig-zstd binary not found at ${ZIG_ZSTD}`);

	rmSync(STAGING, { recursive: true, force: true });
	mkdirSync(STAGING, { recursive: true });

	// 1. Decompress <hash>.tar.zst → <STAGING>/payload.tar
	const tarPath = join(STAGING, 'payload.tar');
	console.log(`  decompressing ${payload}`);
	const decompress = spawnSync(
		ZIG_ZSTD,
		['decompress', '-i', payload, '-o', tarPath],
		{ stdio: 'inherit' },
	);
	if (decompress.status !== 0) fail('zig-zstd decompress failed');

	// 2. Extract the tar — its top-level entry is FindaGameLikeThat/, so we
	//    extract into STAGING and then move that subdir's contents up.
	const extractTmp = join(STAGING, 'tar-out');
	mkdirSync(extractTmp, { recursive: true });
	console.log(`  extracting tar`);
	// Use Windows's built-in bsdtar at C:\Windows\System32\tar.exe — the
	// MSYS/Cygwin `tar` on PATH treats "D:\..." as a remote host and dies
	// with "Cannot connect to D: resolve failed".
	const tarBin = 'C:\\Windows\\System32\\tar.exe';
	if (!existsSync(tarBin))
		fail(`Windows bsdtar not found at ${tarBin} (need Windows 10 1803+)`);
	const extract = spawnSync(tarBin, ['-xf', tarPath, '-C', extractTmp], {
		stdio: 'inherit',
	});
	if (extract.status !== 0) fail('tar extract failed');

	// 3. Move FindaGameLikeThat/* up to STAGING/.
	const innerTop = join(extractTmp, 'FindaGameLikeThat');
	if (!existsSync(innerTop) || !statSync(innerTop).isDirectory())
		fail(
			`expected FindaGameLikeThat/ inside payload tar; got: ${readdirSync(extractTmp).join(', ')}`,
		);

	for (const entry of readdirSync(innerTop)) {
		const src = join(innerTop, entry);
		const dst = join(STAGING, entry);
		// On Windows, `move` (renameSync) across the same volume is fine.
		// We use cp -r as a portable fallback under Bun's API.
		spawnSync('cmd', ['/c', 'move', '/Y', src, dst], { stdio: 'ignore' });
		if (!existsSync(dst)) fail(`failed to stage ${entry} into ${STAGING}`);
	}

	rmSync(extractTmp, { recursive: true, force: true });
	rmSync(tarPath, { force: true });

	const launcherExe = join(STAGING, 'bin', 'launcher.exe');
	if (!existsSync(launcherExe))
		fail(`real launcher.exe missing from extracted bundle at ${launcherExe}`);
	const sz = statSync(launcherExe).size;
	console.log(`  staged real launcher.exe (${sz} bytes)`);

	// Note: we considered renaming bin/bun.exe to break the name
	// collision with users' globally-installed Bun. Skipped because
	// Electrobun's launcher binary spawns "bun.exe" by name from
	// compiled native code that isn't patchable from JS. Mitigation
	// for the wait-loop hang lives in our custom updater (which
	// bypasses Electrobun's update.bat entirely).
}

async function embedIcon(version: string): Promise<void> {
	// Electrobun's compiled CLI hardcodes a dev-machine path for `rcedit`,
	// so its built-in icon embed fails on every other machine (logged as
	// "Cannot find module … node_modules/rcedit/package.json"). We run
	// rcedit ourselves and also stamp Windows version metadata so File
	// Explorer / taskbar show "Find a Game Like That" instead of blanks.
	const launcher = join(STAGING, 'bin', 'launcher.exe');
	if (!existsSync(launcher)) fail(`launcher.exe missing at ${launcher}`);
	try {
		await rcedit(launcher, {
			icon: ICON,
			'file-version': version,
			'product-version': version,
			'version-string': {
				ProductName: 'Find a Game Like That',
				FileDescription: 'Find a Game Like That',
				CompanyName: 'Kevin Batdorf',
				LegalCopyright: 'Kevin Batdorf',
				OriginalFilename: 'launcher.exe',
				InternalName: 'Find a Game Like That',
			},
		});
		console.log(`  embedded icon + metadata → ${launcher}`);
	} catch (e) {
		fail(`rcedit failed on launcher: ${e instanceof Error ? e.message : e}`);
	}

	// Stamp bun.exe with our icon + metadata. It owns the visible
	// window (launcher.exe spawns it via FFI), so its PE metadata is
	// what Windows uses for the taskbar pin name and "Open With"
	// dialog labels.
	const bun = join(STAGING, 'bin', 'bun.exe');
	if (existsSync(bun)) {
		try {
			await rcedit(bun, {
				icon: ICON,
				'file-version': version,
				'product-version': version,
				'version-string': {
					ProductName: 'Find a Game Like That',
					FileDescription: 'Find a Game Like That',
					CompanyName: 'Kevin Batdorf',
					LegalCopyright: 'Kevin Batdorf',
					OriginalFilename: 'bun.exe',
					InternalName: 'Find a Game Like That',
				},
			});
			console.log(`  embedded icon + metadata → ${bun}`);
		} catch (e) {
			fail(`rcedit failed on bun.exe: ${e instanceof Error ? e.message : e}`);
		}
	}
}

function runMakensis(version: string, outputName: string): void {
	const makensis = which('makensis');
	if (!makensis)
		fail('makensis not found on PATH — install NSIS (`choco install nsis -y`)');

	mkdirSync(ARTIFACTS, { recursive: true });

	const args = [
		`-DVERSION=${version}`,
		`-DBUILD_DIR=${STAGING}`,
		`-DOUTPUT_DIR=${ARTIFACTS}`,
		`-DOUTPUT_NAME=${outputName}`,
		`-DICON=${ICON}`,
		NSI,
	];

	console.log(`  makensis ${args.map((a) => JSON.stringify(a)).join(' ')}`);
	const result = spawnSync(makensis, args, { stdio: 'inherit' });
	if (result.status !== 0) fail(`makensis exited with status ${result.status}`);
}

const version = await readVersion();
// Stable filename (no version in it) so the in-app updater can fetch
// `releases/latest/download/FindAGameLikeThat-Setup.exe` without
// having to know what the latest version number is. Version still
// shows in the .exe's PE metadata, in the release name, and in Apps
// & Features after install.
const outputName = 'FindAGameLikeThat-Setup.exe';

console.log(`package-windows: building installer for v${version}`);
stage();
await embedIcon(version);
runMakensis(version, outputName);
console.log(`package-windows: wrote ${join(ARTIFACTS, outputName)}`);
