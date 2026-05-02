import { rpc } from './lib/rpc';

/**
 * Static setup walkthrough — works without an API connection. Reachable
 * any time via the sidebar Settings → Setup guide entry, and surfaced
 * automatically by HealthBanner when the API is unreachable.
 *
 * Intentionally pure content — no API calls, no state. This is the page
 * a brand-new user lands on if they download the binary without Docker
 * already running.
 */

interface Props {
	onOpenSettings: () => void;
}

export function SetupGuide({ onOpenSettings }: Props) {
	return (
		<div className="max-w-3xl space-y-8">
			<header>
				<h1 className="text-xl font-semibold">Setup guide</h1>
				<p className="text-sm text-zinc-500 mt-1">
					Three pieces: Docker (the database lives there), this app, and a Steam
					API key. Total time: about five minutes.
				</p>
			</header>

			<Step
				n={1}
				title="What is this?"
				body={
					<p>
						<strong>Find a Game Like That</strong> is a personal game-library
						browser. It pulls everything you own on Steam (plus optional Epic /
						GOG), enriches each game with descriptions, tags, completion times,
						and critic scores, and lets you search across the lot — including
						vibe-style queries like "cozy puzzle game with a story" once you
						connect an AI provider.
					</p>
				}
			/>

			<Step
				n={2}
				title="Install Docker Desktop"
				body={
					<>
						<p>
							The database (Postgres + pgvector) and the API server run as a
							small Docker stack. The desktop app talks to that stack over
							localhost.
						</p>
						<div className="flex flex-wrap gap-2 mt-2">
							<LinkButton url="https://www.docker.com/products/docker-desktop/">
								Docker Desktop ↗
							</LinkButton>
							<LinkButton url="https://docs.docker.com/desktop/install/windows-install/">
								Windows install
							</LinkButton>
							<LinkButton url="https://docs.docker.com/desktop/install/mac-install/">
								macOS install
							</LinkButton>
							<LinkButton url="https://docs.docker.com/desktop/install/linux-install/">
								Linux install
							</LinkButton>
						</div>
						<p className="text-xs text-zinc-500 mt-2">
							If you already have Docker installed but the app is still
							complaining, just make sure Docker Desktop is <em>running</em> —
							it doesn't auto-start by default.
						</p>
					</>
				}
			/>

			<Step
				n={3}
				title="Start the backend stack"
				body={
					<>
						<p>
							Grab the consumer compose file from the{' '}
							<button
								type="button"
								onClick={() =>
									rpc.request.openUrl({
										url: 'https://github.com/KevinBatdorf/fglt/releases/latest',
									})
								}
								className="underline hover:no-underline text-zinc-200"
							>
								latest release ↗
							</button>{' '}
							(it's named <code>docker-compose.consumer.yml</code>), then from
							the folder you saved it in:
						</p>
						<pre className="bg-zinc-950 border border-zinc-800 rounded-md p-3 text-[11px] text-zinc-300 overflow-x-auto">
							{`docker compose -f docker-compose.consumer.yml up -d`}
						</pre>
						<p className="text-xs text-zinc-500">
							This downloads the API + Postgres images and runs them on ports
							3110 and 5532. Stop them later with{' '}
							<code>docker compose -f docker-compose.consumer.yml down</code>.
						</p>
					</>
				}
			/>

			<Step
				n={4}
				title="Add your Steam credentials"
				body={
					<>
						<p>
							Once Docker is up, the app's banner will clear and you'll land on
							the Configuration page. You need two things:
						</p>
						<ul className="list-disc pl-5 space-y-1 text-sm text-zinc-300">
							<li>
								<strong>Steam API key</strong> —{' '}
								<button
									type="button"
									onClick={() =>
										rpc.request.openUrl({
											url: 'https://steamcommunity.com/dev/apikey',
										})
									}
									className="underline hover:no-underline text-zinc-200"
								>
									get one at steamcommunity.com/dev/apikey ↗
								</button>
							</li>
							<li>
								<strong>Steam ID (64-bit)</strong> —{' '}
								<button
									type="button"
									onClick={() =>
										rpc.request.openUrl({ url: 'https://steamid.io/' })
									}
									className="underline hover:no-underline text-zinc-200"
								>
									paste your profile URL into steamid.io ↗
								</button>
							</li>
						</ul>
						<button
							type="button"
							onClick={onOpenSettings}
							className="mt-3 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium"
						>
							Open Settings → Configuration
						</button>
					</>
				}
			/>

			<Step
				n={5}
				title="Optional integrations"
				body={
					<>
						<p>
							Library is fully functional without these — they enrich individual
							game cards.
						</p>
						<table className="text-xs w-full border border-zinc-800 rounded-md overflow-hidden">
							<thead>
								<tr className="bg-zinc-900 text-zinc-400">
									<th className="text-left px-3 py-1.5 font-medium">
										Provider
									</th>
									<th className="text-left px-3 py-1.5 font-medium">
										What it adds
									</th>
									<th className="text-left px-3 py-1.5 font-medium">
										Where to get a key
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-zinc-800">
								<tr>
									<td className="px-3 py-1.5">AI provider</td>
									<td className="px-3 py-1.5 text-zinc-400">
										Hybrid semantic search + generated vibe chips
									</td>
									<td className="px-3 py-1.5">
										<LinkButton url="https://ollama.com/">Ollama</LinkButton> or{' '}
										<LinkButton url="https://platform.openai.com/api-keys">
											OpenAI
										</LinkButton>
									</td>
								</tr>
								<tr>
									<td className="px-3 py-1.5">YouTube</td>
									<td className="px-3 py-1.5 text-zinc-400">
										Embedded gameplay videos per game
									</td>
									<td className="px-3 py-1.5">
										<LinkButton url="https://console.cloud.google.com/apis/credentials">
											Google Cloud
										</LinkButton>
									</td>
								</tr>
								<tr>
									<td className="px-3 py-1.5">OpenCritic</td>
									<td className="px-3 py-1.5 text-zinc-400">
										Critic score + tier badge
									</td>
									<td className="px-3 py-1.5">
										<LinkButton url="https://rapidapi.com/opencritic-opencritic-default/api/opencritic-api">
											RapidAPI
										</LinkButton>
									</td>
								</tr>
							</tbody>
						</table>
					</>
				}
			/>
		</div>
	);
}

function Step({
	n,
	title,
	body,
}: {
	n: number;
	title: string;
	body: React.ReactNode;
}) {
	return (
		<section>
			<div className="flex items-baseline gap-2 mb-2">
				<span className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">
					Step {n}
				</span>
				<h2 className="text-base font-semibold text-zinc-100">{title}</h2>
			</div>
			<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3 text-sm text-zinc-300">
				{body}
			</div>
		</section>
	);
}

function LinkButton({
	url,
	children,
}: {
	url: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={() => rpc.request.openUrl({ url })}
			className="text-xs text-zinc-300 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded px-2 py-0.5 transition-colors"
			title={url}
		>
			{children}
		</button>
	);
}
