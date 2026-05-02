import type { ElectrobunConfig } from 'electrobun';

export default {
	app: {
		name: 'Find a Game Like That',
		identifier: 'fglt.kbatdorf.dev',
		version: '0.1.0',
	},
	build: {
		// Vite builds to dist/, we copy from there
		copy: {
			'dist/index.html': 'views/mainview/index.html',
			'dist/assets': 'views/mainview/assets',
		},
		// Ignore Vite output in watch mode — HMR handles view rebuilds separately
		watchIgnore: ['dist/**'],
		mac: {
			bundleCEF: false,
			icons: 'assets/icon.iconset',
		},
		linux: {
			bundleCEF: false,
			icon: 'assets/icon-512.png',
		},
		win: {
			bundleCEF: false,
			icon: 'assets/icon.ico',
		},
	},
	release: {
		// GitHub releases auto-update host. The Updater fetches
		// `${baseUrl}/${platformPrefix}-update.json` (e.g.
		// `…/stable-win-x64-update.json`) and downloads the matching
		// tarball or patch from the same release. `latest/download` always
		// resolves to the newest tag, so we don't have to bake the version
		// into the URL.
		baseUrl: 'https://github.com/KevinBatdorf/fglt/releases/latest/download',
		generatePatch: true,
	},
} satisfies ElectrobunConfig;
