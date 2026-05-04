#!/usr/bin/env bun
/**
 * Generate Windows app icons from the master logo PNG.
 *
 * Inputs:
 *   logo.png at the repo root (square, ≥1024×1024).
 *
 * Outputs (committed):
 *   apps/desktop/assets/icon-1024.png — 1024×1024 master raster
 *   apps/desktop/assets/icon.ico      — Windows multi-size (16/32/48/64/128/256)
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
const SRC = join(REPO_ROOT, 'logo.png');

async function pngBuffer(size: number): Promise<Buffer> {
	return await sharp(SRC).resize(size, size, { fit: 'cover' }).png().toBuffer();
}

async function writePng(name: string, size: number): Promise<void> {
	const buf = await pngBuffer(size);
	await writeFile(join(ASSETS, name), buf);
	console.log(`  wrote ${name} (${size}×${size})`);
}

async function main() {
	console.log(`reading ${SRC}`);

	await writePng('icon-1024.png', 1024);

	console.log('building icon.ico');
	const icoSizes = [16, 32, 48, 64, 128, 256];
	const icoPngs = await Promise.all(icoSizes.map((s) => pngBuffer(s)));
	const icoBuf = await pngToIco(icoPngs);
	await writeFile(join(ASSETS, 'icon.ico'), icoBuf);
	console.log(`  wrote icon.ico (${icoSizes.join('/')})`);

	console.log('done');
}

await main();
