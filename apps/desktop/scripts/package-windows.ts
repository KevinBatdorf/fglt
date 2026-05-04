#!/usr/bin/env bun
/**
 * Wrap the Electrobun-emitted bundle in an NSIS installer.
 *
 * Pre-conditions: `electrobun build --env=stable` has run, producing
 *   apps/desktop/build/stable-win-x64/FindaGameLikeThat/
 *
 * Steps:
 *   1. Make a clean copy of FindaGameLikeThat/ at build/installer-input/
 *      so we can mutate it (rename launcher → launcher.exe) without
 *      polluting the original Electrobun output.
 *   2. Rename bin/launcher to bin/launcher.exe — Windows shell shortcuts
 *      and SmartScreen recognize PE files better with the .exe suffix.
 *   3. Invoke makensis with -DVERSION / -DBUILD_DIR / -DOUTPUT_DIR /
 *      -DOUTPUT_NAME / -DICON.
 *   4. Drop the resulting installer into apps/desktop/artifacts/.
 *
 * Run with: `bun run build:installer`
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
// @ts-expect-error — rcedit ships JS with no bundled .d.ts on this version
import rcedit from 'rcedit';

const ROOT = join(import.meta.dir, '..');
const BUILD = join(ROOT, 'build', 'stable-win-x64');
const APP_SRC = join(BUILD, 'FindaGameLikeThat');
const STAGING = join(ROOT, 'build', 'installer-input');
const NSI = join(ROOT, 'installer', 'fglt.nsi');
const ICON = join(ROOT, 'assets', 'icon.ico');
const ARTIFACTS = join(ROOT, 'artifacts');

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

function stage(): void {
	if (!existsSync(APP_SRC))
		fail(
			`expected Electrobun bundle at ${APP_SRC} — run \`bun run build\` first`,
		);
	rmSync(STAGING, { recursive: true, force: true });
	mkdirSync(STAGING, { recursive: true });
	cpSync(APP_SRC, STAGING, { recursive: true });

	const launcher = join(STAGING, 'bin', 'launcher');
	const launcherExe = join(STAGING, 'bin', 'launcher.exe');
	if (existsSync(launcher) && !existsSync(launcherExe)) {
		renameSync(launcher, launcherExe);
		console.log('  renamed bin/launcher → bin/launcher.exe');
	} else if (!existsSync(launcherExe)) {
		fail(`expected launcher binary at ${launcher} or ${launcherExe}`);
	}
}

async function embedIcon(): Promise<void> {
	// Electrobun's compiled CLI hardcodes a dev-machine path for `rcedit`,
	// so its built-in icon embed fails on every other machine (logged as
	// "Cannot find module … node_modules/rcedit/package.json"). We run
	// rcedit ourselves against the staged binaries instead.
	const targets = [
		join(STAGING, 'bin', 'launcher.exe'),
		join(STAGING, 'bin', 'bun.exe'),
	];
	for (const target of targets) {
		if (!existsSync(target)) {
			console.warn(`  skip embed: ${target} not found`);
			continue;
		}
		try {
			await rcedit(target, { icon: ICON });
			console.log(`  embedded icon → ${target}`);
		} catch (e) {
			fail(`rcedit failed on ${target}: ${e instanceof Error ? e.message : e}`);
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
const outputName = `FindAGameLikeThat-${version}-win-x64-Setup.exe`;

console.log(`package-windows: building installer for v${version}`);
stage();
await embedIcon();
runMakensis(version, outputName);
console.log(`package-windows: wrote ${join(ARTIFACTS, outputName)}`);
