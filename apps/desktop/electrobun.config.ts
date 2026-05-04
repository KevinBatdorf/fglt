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
			// Bundle the consumer compose file next to the binary so the
			// app can manage the Docker stack itself (no terminal required).
			// Copied here from the repo root by `bun run build:assets`.
			'assets/docker-compose.consumer.yml':
				'assets/docker-compose.consumer.yml',
			// Backend source (Dockerfile + src + scripts + migrations + init.sql
			// + package.json + bun.lock) bundled by `scripts/bundle-backend.ts`
			// so the consumer compose's `build: ./backend` directive resolves.
			// We build the API image on the user's machine instead of pulling
			// from a registry — no GHCR / Docker Hub publishing required.
			'assets/backend': 'assets/backend',
		},
		// Ignore Vite output in watch mode — HMR handles view rebuilds separately
		watchIgnore: ['dist/**'],
		// Windows-only by design. Release pipeline wraps the build output in
		// an NSIS installer; mac/linux scaffolding was removed deliberately.
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
