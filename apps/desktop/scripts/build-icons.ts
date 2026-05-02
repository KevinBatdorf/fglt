#!/usr/bin/env bun
/**
 * Generate every platform-specific app icon from the master SVG.
 *
 * Inputs:
 *   apps/desktop/assets/icon.svg
 *
 * Outputs (committed):
 *   apps/desktop/assets/icon-1024.png   — master raster, also the favicon
 *   apps/desktop/assets/icon-512.png    — Linux taskbar icon
 *   apps/desktop/assets/icon.ico        — Windows multi-size .ico
 *   apps/desktop/assets/icon.iconset/   — macOS iconset (Apple's standard
 *                                          ladder; can be turned into a
 *                                          .icns by `iconutil` on macOS)
 *
 * Run with: `bun run build:icons`
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const ROOT = join(import.meta.dir, '..');
const ASSETS = join(ROOT, 'assets');
const SRC = join(ASSETS, 'icon.svg');

async function pngBuffer(size: number): Promise<Buffer> {
	return await sharp(SRC).resize(size, size).png().toBuffer();
}

async function writePng(name: string, size: number): Promise<void> {
	const buf = await pngBuffer(size);
	await writeFile(join(ASSETS, name), buf);
	console.log(`  wrote ${name} (${size}×${size})`);
}

async function main() {
	console.log(`reading ${SRC}`);

	// Master + Linux
	await writePng('icon-1024.png', 1024);
	await writePng('icon-512.png', 512);

	// Windows .ico — multi-size (16/32/48/64/128/256). png-to-ico packs
	// these into one .ico file.
	console.log('building icon.ico');
	const icoSizes = [16, 32, 48, 64, 128, 256];
	const icoPngs = await Promise.all(icoSizes.map((s) => pngBuffer(s)));
	const icoBuf = await pngToIco(icoPngs);
	await writeFile(join(ASSETS, 'icon.ico'), icoBuf);
	console.log(`  wrote icon.ico (${icoSizes.join('/')})`);

	// macOS .iconset folder. Apple's expected naming:
	//   icon_16x16.png / icon_16x16@2x.png / ... / icon_512x512@2x.png
	const iconset = join(ASSETS, 'icon.iconset');
	await rm(iconset, { recursive: true, force: true });
	await mkdir(iconset, { recursive: true });
	const macSpec: Array<{ name: string; size: number }> = [
		{ name: 'icon_16x16.png', size: 16 },
		{ name: 'icon_16x16@2x.png', size: 32 },
		{ name: 'icon_32x32.png', size: 32 },
		{ name: 'icon_32x32@2x.png', size: 64 },
		{ name: 'icon_128x128.png', size: 128 },
		{ name: 'icon_128x128@2x.png', size: 256 },
		{ name: 'icon_256x256.png', size: 256 },
		{ name: 'icon_256x256@2x.png', size: 512 },
		{ name: 'icon_512x512.png', size: 512 },
		{ name: 'icon_512x512@2x.png', size: 1024 },
	];
	console.log('building icon.iconset/');
	for (const { name, size } of macSpec) {
		const buf = await pngBuffer(size);
		await writeFile(join(iconset, name), buf);
	}
	console.log(`  wrote icon.iconset/ (${macSpec.length} files)`);

	console.log('done');
}

await main();
