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
			// Favicon referenced by index.html as `/icon.png` — without
			// this WebView2 logs "Could not open views file" and falls
			// back to a generated tile from the page title.
			'dist/icon.png': 'views/mainview/icon.png',
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
		// GitHub releases host the published manifest. The in-app "Check
		// now" reads `${baseUrl}/${platformPrefix}-update.json`. We don't
		// auto-download — clicking "Download from GitHub" opens the
		// release page in the user's browser instead. So no need to ship
		// bsdiff patch files (Electrobun's `generatePatch` would emit
		// them otherwise).
		baseUrl: 'https://github.com/KevinBatdorf/fglt/releases/latest/download',
		generatePatch: false,
	},
} satisfies ElectrobunConfig;
