import { useEffect, useState } from "react";
import {
	type GameDetail as GameDetailType,
	type LibraryGame,
	type ListSummary,
	api,
	steamImg,
} from "./lib/api";
import { rpc } from "./lib/rpc";
import type { InstalledIndex, Platform } from "../shared/types";

interface Props {
	stack: number[];
	installed: InstalledIndex | null;
	onBack: () => void;
	onClose: () => void;
	onNavigate: (appid: number) => void;
}

/**
 * Full-page (99% inset) modal with a navigation stack so Similar and other
 * cross-links can be followed without losing context. Top-left ← back appears
 * once stack length > 1; ✕ closes the whole stack.
 */
export function GameDetail({
	stack,
	installed,
	onBack,
	onClose,
	onNavigate,
}: Props) {
	const appid = stack[stack.length - 1];

	useEffect(() => {
		const handle = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handle);
		return () => window.removeEventListener("keydown", handle);
	}, [onClose]);

	return (
		<div
			className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-stretch justify-center"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
			role="dialog"
			aria-modal="true"
			tabIndex={-1}
		>
			<div className="relative w-[98vw] h-[97vh] my-auto rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden shadow-2xl flex flex-col">
				<div className="absolute top-3 left-3 right-3 z-20 flex items-center gap-2">
					{stack.length > 1 ? (
						<button
							type="button"
							onClick={onBack}
							className="px-3 py-1.5 rounded-full bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm flex items-center gap-1.5"
						>
							<span aria-hidden>←</span>
							<span>Back</span>
						</button>
					) : (
						<div />
					)}
					<div className="flex-1" />
					<button
						type="button"
						onClick={onClose}
						className="w-9 h-9 rounded-full bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white text-base"
						aria-label="Close detail"
					>
						✕
					</button>
				</div>
				<div className="flex-1 overflow-y-auto">
					<DetailBody
						appid={appid}
						installed={installed}
						onNavigate={onNavigate}
					/>
				</div>
			</div>
		</div>
	);
}

function DetailBody({
	appid,
	installed,
	onNavigate,
}: {
	appid: number;
	installed: InstalledIndex | null;
	onNavigate: (appid: number) => void;
}) {
	const [game, setGame] = useState<GameDetailType | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [vectorSimilar, setVectorSimilar] = useState<LibraryGame[] | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [refreshResult, setRefreshResult] = useState<string | null>(null);

	useEffect(() => {
		const ctrl = new AbortController();
		setGame(null);
		setError(null);
		setVectorSimilar(null);
		api
			.game(appid, ctrl.signal)
			.then(setGame)
			.catch((e) => {
				if (e.name !== "AbortError") setError(`Load failed: ${e.message}`);
			});
		api
			.similar({ appid, limit: 12 }, ctrl.signal)
			.then((d) => setVectorSimilar(d.results))
			.catch((e) => {
				if (e.name !== "AbortError") console.warn("similar failed", e);
			});
		return () => ctrl.abort();
	}, [appid]);

	const installedPlatforms =
		game !== null
			? game.platforms.filter((p) => isInstalledFor(installed, p, game))
			: [];
	const positivePct = game ? positivePctOf(game) : null;
	const launchPlatform = installedPlatforms[0] ?? game?.platforms[0];

	async function handleLaunch(platform: Platform, action: "run" | "install") {
		if (!game) return;
		if (action === "install" && platform === "steam") {
			await rpc.request.openUrl({ url: `steam://install/${game.appid}` });
			return;
		}
		const ownership = game.ownership.find((o) => o.platform === platform);
		const externalId = ownership?.external_id ?? String(game.appid);
		const result = await rpc.request.launch({
			platform,
			externalId,
			appid: game.appid,
		});
		if (!result.ok) console.error("launch failed:", result.error);
	}

	async function handleRefresh() {
		if (!game) return;
		setRefreshing(true);
		setRefreshResult(null);
		try {
			const r = await rpc.request.refreshGame({ appid: game.appid });
			setRefreshResult(
				Object.entries(r.sources)
					.map(([k, v]) => `${k}:${v.status}`)
					.join(" · "),
			);
			const updated = await api.game(game.appid);
			setGame(updated);
		} catch (e) {
			setRefreshResult(`error: ${e instanceof Error ? e.message : e}`);
		} finally {
			setRefreshing(false);
		}
	}

	if (error) {
		return <div className="p-12 text-red-400 text-sm">{error}</div>;
	}
	if (!game) {
		return <div className="p-12 text-zinc-500 text-sm">Loading…</div>;
	}

	const releaseYear = game.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
	const heroSrc = steamImg(game.appid, "library_hero");
	const topTags = game.tags.slice(0, 8);

	return (
		<>
			<div className="relative">
				<img
					src={heroSrc}
					alt=""
					className="w-full h-[420px] object-cover"
					onError={(e) => {
						if (game.header_image && e.currentTarget.src !== game.header_image) {
							e.currentTarget.src = game.header_image;
						}
					}}
				/>
				<div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-zinc-950/10" />
				<div className="absolute bottom-0 left-0 right-0 p-8 max-w-5xl">
					<h2 className="text-4xl lg:text-5xl font-bold leading-tight drop-shadow-lg">
						{game.name}
					</h2>
					<div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-zinc-200">
						{releaseYear && <span>{releaseYear}</span>}
						{game.developers && game.developers.length > 0 && (
							<>
								<span className="opacity-50">·</span>
								<span>{game.developers.join(", ")}</span>
							</>
						)}
						{game.genres && game.genres.length > 0 && (
							<>
								<span className="opacity-50">·</span>
								<span>{game.genres.slice(0, 3).join(" / ")}</span>
							</>
						)}
					</div>
				</div>
			</div>

			<div className="px-8 py-6 max-w-6xl space-y-8">
				<section>
					<div className="flex flex-wrap gap-2 mb-4">
						{game.platforms.map((p) => (
							<PlatformBadge
								key={p}
								platform={p}
								installed={isInstalledFor(installed, p, game)}
							/>
						))}
					</div>
					{launchPlatform && (
						<div className="flex flex-wrap items-center gap-2">
							<LaunchButton
								platform={launchPlatform}
								installed={installedPlatforms.includes(launchPlatform)}
								onLaunch={(action) => handleLaunch(launchPlatform, action)}
							/>
							{game.platforms.length > 1 &&
								game.platforms
									.filter((p) => p !== launchPlatform)
									.map((p) => (
										<button
											key={p}
											type="button"
											onClick={() =>
												handleLaunch(
													p,
													isInstalledFor(installed, p, game) ? "run" : "install",
												)
											}
											className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm"
											title={`Launch on ${p}`}
										>
											{capitalize(p)}
										</button>
									))}
							<button
								type="button"
								onClick={handleRefresh}
								disabled={refreshing}
								className="ml-auto px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm disabled:opacity-50"
							>
								{refreshing ? "Refreshing…" : "Refresh data"}
							</button>
						</div>
					)}
					{refreshResult && (
						<div className="mt-2 text-[11px] text-zinc-500 font-mono">
							{refreshResult}
						</div>
					)}
				</section>

				<ListsSection
					appid={game.appid}
					memberOf={game.lists}
					onChange={async () => {
						const updated = await api.game(game.appid);
						setGame(updated);
					}}
				/>

				<div className="grid lg:grid-cols-[1.5fr_1fr] gap-8">
					<div className="space-y-6">
						{game.short_desc && (
							<section>
								<p className="text-base text-zinc-200 leading-relaxed">
									{game.short_desc}
								</p>
							</section>
						)}

						{topTags.length > 0 && (
							<section>
								<h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
									Tags
								</h3>
								<div className="flex flex-wrap gap-1.5">
									{topTags.map((t) => (
										<span
											key={t.tag}
											className="text-xs px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300"
											title={`${t.votes.toLocaleString()} votes`}
										>
											{t.tag}
										</span>
									))}
								</div>
							</section>
						)}

						{game.videos.length > 0 && (
							<section>
								<h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
									Videos
								</h3>
								<div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
									{game.videos.slice(0, 6).map((v) => (
										<VideoThumb key={v.video_id} video={v} />
									))}
								</div>
							</section>
						)}
					</div>

					<div className="space-y-6">
						<StatsRow game={game} positivePct={positivePct} />

						{game.ownership.length > 0 && (
							<section>
								<h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
									Ownership
								</h3>
								<ul className="space-y-1.5 text-sm">
									{game.ownership.map((o) => {
										const inst = isInstalledFor(installed, o.platform, game);
										return (
											<li
												key={o.platform}
												className="flex items-center justify-between rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2"
											>
												<span className="font-medium">{capitalize(o.platform)}</span>
												<span
													className={`text-xs ${
														inst ? "text-emerald-400" : "text-zinc-500"
													}`}
												>
													{inst ? "● Installed" : "Owned"}
												</span>
											</li>
										);
									})}
								</ul>
							</section>
						)}
					</div>
				</div>

				<section>
					<h3 className="text-base font-semibold mb-3">
						Similar games you own
					</h3>
					{vectorSimilar === null ? (
						<div className="text-sm text-zinc-500">Finding similar…</div>
					) : vectorSimilar.length === 0 ? (
						<div className="text-sm text-zinc-500">
							No close matches in your library.
						</div>
					) : (
						<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
							{vectorSimilar.slice(0, 12).map((s) => (
								<SimilarCard
									key={s.appid}
									game={s}
									installed={installed}
									onClick={() => onNavigate(s.appid)}
								/>
							))}
						</div>
					)}
				</section>

				{game.similar.length > 0 && (
					<section>
						<h3 className="text-base font-semibold mb-3">
							Steam suggests
							<span className="ml-2 text-xs text-zinc-500 font-normal">
								(may include games you don't own)
							</span>
						</h3>
						<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
							{game.similar
								.filter((s) => s.header_image)
								.slice(0, 12)
								.map((s) => (
									<button
										key={s.appid}
										type="button"
										onClick={() => onNavigate(s.appid)}
										className="text-left rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors"
									>
										{s.header_image && (
											<img src={s.header_image} alt={s.name ?? ""} className="w-full" />
										)}
										<div className="p-2 text-xs text-zinc-200 truncate">
											{s.name}
										</div>
									</button>
								))}
						</div>
					</section>
				)}
			</div>
		</>
	);
}

function LaunchButton({
	platform,
	installed,
	onLaunch,
}: {
	platform: Platform;
	installed: boolean;
	onLaunch: (action: "run" | "install") => void;
}) {
	if (installed) {
		return (
			<button
				type="button"
				onClick={() => onLaunch("run")}
				className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-colors"
			>
				Launch on {capitalize(platform)}
			</button>
		);
	}
	return (
		<button
			type="button"
			onClick={() => onLaunch("install")}
			className="px-5 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-sm border border-zinc-700 transition-colors"
		>
			{platform === "steam"
				? "Install with Steam"
				: `Open on ${capitalize(platform)}`}
		</button>
	);
}

function ListsSection({
	appid,
	memberOf,
	onChange,
}: {
	appid: number;
	memberOf: GameDetailType["lists"];
	onChange: () => void | Promise<void>;
}) {
	const [allLists, setAllLists] = useState<ListSummary[] | null>(null);
	const [showPicker, setShowPicker] = useState(false);
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");

	useEffect(() => {
		if (!showPicker) return;
		api.lists().then((d) => setAllLists(d.lists));
	}, [showPicker]);

	const memberSet = new Set(memberOf.map((l) => l.id));

	async function toggle(list: ListSummary) {
		if (memberSet.has(list.id)) {
			await api.removeFromList(list.id, appid);
		} else {
			await api.addToList(list.id, appid);
		}
		await onChange();
		const refreshed = await api.lists();
		setAllLists(refreshed.lists);
	}

	async function handleCreate() {
		if (!newName.trim()) return;
		const created = await api.createList(newName.trim());
		await api.addToList(created.id, appid);
		setNewName("");
		setCreating(false);
		await onChange();
		const refreshed = await api.lists();
		setAllLists(refreshed.lists);
	}

	return (
		<section>
			<div className="flex items-center gap-3">
				{memberOf.length > 0 && (
					<div className="flex flex-wrap gap-1.5">
						{memberOf.map((l) => (
							<span
								key={l.id}
								className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/50 border border-emerald-700/50 text-emerald-100"
							>
								{l.emoji && <span className="mr-1">{l.emoji}</span>}
								{l.name}
							</span>
						))}
					</div>
				)}
				<button
					type="button"
					onClick={() => setShowPicker((v) => !v)}
					className="text-xs text-emerald-400 hover:text-emerald-300"
				>
					{showPicker ? "Done" : memberOf.length > 0 ? "Edit lists" : "Add to list…"}
				</button>
			</div>

			{showPicker && allLists && (
				<div className="mt-3 max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-2 space-y-1">
					{allLists.map((l) => {
						const isMember = memberSet.has(l.id);
						return (
							<button
								type="button"
								key={l.id}
								onClick={() => toggle(l)}
								className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-sm text-left"
							>
								<span className="w-4 text-center">{isMember ? "✓" : ""}</span>
								<span className="w-5 text-center">{l.emoji ?? "📋"}</span>
								<span className="flex-1">{l.name}</span>
								<span className="text-[10px] text-zinc-500 tabular-nums">
									{l.count ?? 0}
								</span>
							</button>
						);
					})}
					<div className="pt-1 mt-1 border-t border-zinc-800">
						{creating ? (
							<div className="flex gap-1 px-1">
								<input
									autoFocus
									type="text"
									value={newName}
									onChange={(e) => setNewName(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") void handleCreate();
										if (e.key === "Escape") {
											setCreating(false);
											setNewName("");
										}
									}}
									placeholder="New list name"
									className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm focus:outline-none focus:border-zinc-600"
								/>
								<button
									type="button"
									onClick={handleCreate}
									className="px-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
								>
									Add
								</button>
							</div>
						) : (
							<button
								type="button"
								onClick={() => setCreating(true)}
								className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-sm text-zinc-400 text-left"
							>
								<span className="w-4 text-center">+</span>
								<span>New list</span>
							</button>
						)}
					</div>
				</div>
			)}
		</section>
	);
}

function PlatformBadge({
	platform,
	installed,
}: {
	platform: Platform;
	installed: boolean;
}) {
	return (
		<span
			className={`text-[11px] uppercase tracking-wide px-2.5 py-1 rounded-full font-medium ${
				installed
					? "bg-emerald-900/60 border border-emerald-700/60 text-emerald-200"
					: "bg-zinc-800 text-zinc-400 border border-zinc-700/60"
			}`}
			title={installed ? "Installed on this machine" : "Owned but not installed"}
		>
			{installed && <span className="mr-1.5">●</span>}
			{platform}
		</span>
	);
}

function StatsRow({
	game,
	positivePct,
}: {
	game: GameDetailType;
	positivePct: number | null;
}) {
	const items: { label: string; value: string }[] = [];
	if (game.hltb_main !== null)
		items.push({ label: "Main story", value: `${game.hltb_main}h` });
	if (game.hltb_extra !== null)
		items.push({ label: "+ Extras", value: `${game.hltb_extra}h` });
	if (game.hltb_complete !== null)
		items.push({ label: "100%", value: `${game.hltb_complete}h` });
	if (positivePct !== null)
		items.push({ label: "Reviews", value: `${positivePct}% positive` });
	if (game.metacritic !== null)
		items.push({ label: "Metacritic", value: String(game.metacritic) });
	if (game.playtime_min > 0)
		items.push({
			label: "You played",
			value: `${Math.round(game.playtime_min / 60)}h`,
		});

	if (items.length === 0) return null;

	return (
		<section>
			<h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
				Stats
			</h3>
			<div className="grid grid-cols-2 gap-2">
				{items.map((it) => (
					<div
						key={it.label}
						className="bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3"
					>
						<div className="text-[10px] uppercase tracking-wider text-zinc-500">
							{it.label}
						</div>
						<div className="text-sm font-medium tabular-nums text-zinc-100">
							{it.value}
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

function VideoThumb({
	video,
}: {
	video: GameDetailType["videos"][number];
}) {
	const url = `https://www.youtube.com/watch?v=${video.video_id}`;
	const handleClick = () => {
		void rpc.request.openUrl({ url });
	};
	return (
		<button
			type="button"
			onClick={handleClick}
			className="text-left rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors"
		>
			{video.thumbnail_url && (
				<img
					src={video.thumbnail_url}
					alt={video.title}
					className="w-full aspect-video object-cover"
				/>
			)}
			<div className="p-2">
				<div className="text-xs text-zinc-200 line-clamp-2 leading-tight">
					{video.title}
				</div>
				<div className="text-[10px] text-zinc-500 mt-1 truncate">
					{video.channel}
				</div>
			</div>
		</button>
	);
}

function SimilarCard({
	game,
	installed,
	onClick,
}: {
	game: LibraryGame;
	installed: InstalledIndex | null;
	onClick: () => void;
}) {
	const isInstalledHere =
		installed !== null && installed.steam.includes(game.appid);
	return (
		<button
			type="button"
			onClick={onClick}
			className="text-left rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors"
		>
			<div className="relative">
				<img
					src={steamImg(game.appid, "library_capsule")}
					alt={game.name}
					loading="lazy"
					onError={(e) => {
						if (game.header_image && e.currentTarget.src !== game.header_image) {
							e.currentTarget.src = game.header_image;
						}
					}}
					className="w-full aspect-[2/3] object-cover bg-zinc-800"
				/>
				{isInstalledHere && (
					<span className="absolute top-1.5 left-1.5 text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-600 text-white shadow">
						Installed
					</span>
				)}
			</div>
			<div className="p-2">
				<div className="text-xs font-medium line-clamp-2 leading-tight min-h-[2rem]">
					{game.name}
				</div>
			</div>
		</button>
	);
}

function isInstalledFor(
	installed: InstalledIndex | null,
	platform: Platform,
	game: GameDetailType,
): boolean {
	if (!installed) return false;
	if (platform === "steam") return installed.steam.includes(game.appid);
	const ext = game.ownership.find((o) => o.platform === platform)?.external_id;
	if (!ext) return false;
	if (platform === "epic") return installed.epic.includes(ext);
	if (platform === "gog") return installed.gog.includes(ext);
	return false;
}

function positivePctOf(game: {
	positive: number | null;
	negative: number | null;
}): number | null {
	if (game.positive === null) return null;
	const pos = game.positive;
	const neg = game.negative ?? 0;
	if (pos + neg === 0) return null;
	return Math.round((pos / (pos + neg)) * 100);
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
