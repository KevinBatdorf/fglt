#!/usr/bin/env bun
/**
 * Generate Windows app icons from the master logo PNG.
 *
 * Inputs:
 *   logo.png at the repo root (square, ≥1024×1024).
 *
 * Outputs (committed):
 *   apps/desktop/assets/icon-1024.png        — 1024×1024 master raster
 *   apps/desktop/assets/icon.ico             — Windows multi-size .ico
 *   apps/desktop/src/mainview/public/icon.png — favicon for index.html
 *                                                (without it WebView2 falls
 *                                                back to a generated "F"
 *                                                tile from the page title)
 *
 * Run with: `bun run build:icons`
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const ROOT = join(import.meta.dir, '..');
const REPO_ROOT = join(ROOT, '..', '..');
const ASSETS = join(ROOT, 'assets');
const PUBLIC_DIR = join(ROOT, 'src', 'mainview', 'public');
const SRC = join(REPO_ROOT, 'logo.png');

async function pngBuffer(size: number): Promise<Buffer> {
	return await sharp(SRC).resize(size, size, { fit: 'cover' }).png().toBuffer();
}

async function writePng(path: string, size: number): Promise<void> {
	const buf = await pngBuffer(size);
	await writeFile(path, buf);
	console.log(`  wrote ${path} (${size}×${size})`);
}

async function main() {
	console.log(`reading ${SRC}`);

	await writePng(join(ASSETS, 'icon-1024.png'), 1024);
	await writePng(join(PUBLIC_DIR, 'icon.png'), 512);

	console.log('building icon.ico');
	const icoSizes = [16, 32, 48, 64, 128, 256];
	const icoPngs = await Promise.all(icoSizes.map((s) => pngBuffer(s)));
	const icoBuf = await pngToIco(icoPngs);
	await writeFile(join(ASSETS, 'icon.ico'), icoBuf);
	console.log(`  wrote icon.ico (${icoSizes.join('/')})`);

	console.log('done');
}

await main();
