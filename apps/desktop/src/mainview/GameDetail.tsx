import { useEffect, useState } from "react";
import { GameImage } from "./GameImage";
import {
	type GameDetail as GameDetailType,
	type LibraryGame,
	type ListSummary,
	api,
} from "./lib/api";
import { rpc } from "./lib/rpc";
import type { InstalledIndex, Platform } from "../shared/types";

interface Props {
	appid: number;
	installed: InstalledIndex | null;
	canBack: boolean;
	onBack: () => void;
	onHome: () => void;
	onNavigate: (appid: number) => void;
}

export function GameDetail({
	appid,
	installed,
	canBack,
	onBack,
	onHome,
	onNavigate,
}: Props) {
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
		setRefreshResult(null);
		setRefreshing(false);
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

	async function handleLaunchAction(platform: Platform) {
		if (!game) return;
		const owned = game.platforms.includes(platform);
		if (!owned) return;
		const ownership = game.ownership.find((o) => o.platform === platform);
		const externalId = ownership?.external_id ?? String(game.appid);
		const isInstalledHere = isInstalledFor(installed, platform, game);

		if (!isInstalledHere) {
			const installUri =
				platform === "steam"
					? `steam://install/${game.appid}`
					: platform === "epic"
						? `com.epicgames.launcher://apps/${externalId}?action=install&silent=true`
						: `goggalaxy://openGameView/${externalId}`;
			await rpc.request.openUrl({ url: installUri });
			return;
		}

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
					.map(([k, v]) => `${k}: ${v.status}`)
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

	const releaseYear =
		game?.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
	const positivePct = game ? positivePctOf(game) : null;
	const topTags = game?.tags.slice(0, 12) ?? [];

	return (
		<div className="-mx-6 -mt-6">
			{/* Hero — nav buttons float on top, never cut off */}
			<div className="relative">
				{game && (
					<GameImage
						appid={game.appid}
						name={game.name}
						alt=""
						variant="library_hero"
						fallback={game.header_image}
						className="w-full h-[340px] object-cover bg-zinc-900"
					/>
				)}
				<div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/30 to-transparent" />

				{/* Top-left: Back — only renders when there's somewhere to go.
				    Home is redundant with the sidebar, so it's not duplicated here. */}
				{canBack && (
					<div className="absolute top-3 left-3 z-10">
						<button
							type="button"
							onClick={onBack}
							className="px-3 py-1.5 rounded-md bg-zinc-950/80 hover:bg-zinc-900 backdrop-blur-sm border border-zinc-700/60 text-sm flex items-center gap-1.5 shadow-lg"
							title="Back (Alt+Left, Backspace)"
						>
							<span aria-hidden>←</span>
							<span>Back</span>
						</button>
					</div>
				)}

				{/* Title overlay at bottom of hero */}
				{game && (
					<div className="absolute bottom-0 left-0 right-0 px-6 py-5 max-w-5xl">
						<h2 className="text-3xl lg:text-4xl font-bold leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
							{game.name}
						</h2>
						<div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-200/90 drop-shadow">
							{releaseYear && <span>{releaseYear}</span>}
							{game?.developers && game.developers.length > 0 && (
								<>
									<span className="opacity-50">·</span>
									<span>{game.developers.join(", ")}</span>
								</>
							)}
							{game?.genres && game.genres.length > 0 && (
								<>
									<span className="opacity-50">·</span>
									<span>{game.genres.slice(0, 3).join(" / ")}</span>
								</>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Body */}
			<div className="px-6 py-6 max-w-6xl space-y-8">
				{error && <div className="text-red-400 text-sm">{error}</div>}
				{!game && !error && (
					<div className="text-zinc-500 text-sm">Loading…</div>
				)}

				{game && (
					<>
						<LaunchRow
							game={game}
							installed={installed}
							onAction={handleLaunchAction}
						/>

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
							</div>

							<div>
								<StatsRow game={game} positivePct={positivePct} />
							</div>
						</div>

						<section>
							<h3 className="text-base font-semibold mb-3">Videos</h3>
							{game.videos.length > 0 ? (
								<>
									<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
										{game.videos.slice(0, 4).map((v) => (
											<VideoEmbed key={v.video_id} video={v} />
										))}
									</div>
									{game.videos.length > 4 && (
										<details className="mt-3">
											<summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
												Show {game.videos.length - 4} more
											</summary>
											<div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
												{game.videos.slice(4).map((v) => (
													<VideoEmbed key={v.video_id} video={v} />
												))}
											</div>
										</details>
									)}
								</>
							) : (
								<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 flex items-center gap-4">
									<div className="flex-1">
										<div className="text-sm text-zinc-200">
											No videos discovered yet
										</div>
										<div className="text-xs text-zinc-500 mt-0.5">
											{refreshing
												? "Fetching from YouTube…"
												: "The discovery cron processes ~100 games/day (newest first). Skip the queue and try now."}
										</div>
										{refreshResult && (
											<div className="text-[11px] text-zinc-500 font-mono mt-1.5">
												{refreshResult}
											</div>
										)}
									</div>
									<button
										type="button"
										onClick={handleRefresh}
										disabled={refreshing}
										className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap"
									>
										{refreshing ? "Fetching…" : "Fetch now"}
									</button>
								</div>
							)}
						</section>

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
													<img
														src={s.header_image}
														alt={s.name ?? ""}
														className="w-full"
													/>
												)}
												<div className="p-2 text-xs text-zinc-200 truncate">
													{s.name}
												</div>
											</button>
										))}
								</div>
							</section>
						)}

						{/* Demoted refresh — small, low-emphasis text link at the bottom */}
						<section className="pt-4 border-t border-zinc-900">
							<div className="flex items-center gap-3 text-[11px] text-zinc-600">
								<button
									type="button"
									onClick={handleRefresh}
									disabled={refreshing}
									className="underline-offset-2 hover:underline hover:text-zinc-400 disabled:opacity-40"
									title="Re-fetch external data (YouTube videos, etc.) for this game. Each source has its own quota — only run when needed."
								>
									{refreshing ? "Refreshing…" : "Re-fetch external data"}
								</button>
								<span className="text-zinc-700">
									Quotas apply (YouTube etc.)
								</span>
								{refreshResult && (
									<span className="font-mono text-zinc-500">
										{refreshResult}
									</span>
								)}
							</div>
						</section>
					</>
				)}
			</div>
		</div>
	);
}

function LaunchRow({
	game,
	installed,
	onAction,
}: {
	game: GameDetailType;
	installed: InstalledIndex | null;
	onAction: (platform: Platform) => void;
}) {
	const platforms: Platform[] = ["steam", "epic", "gog"];
	return (
		<section>
			<h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
				Launch from
			</h3>
			<div className="flex flex-wrap gap-2">
				{platforms.map((p) => {
					const owned = game.platforms.includes(p);
					const installedHere = isInstalledFor(installed, p, game);
					const state = !owned
						? "disabled"
						: installedHere
							? "installed"
							: "owned";
					const label =
						state === "installed"
							? `Launch on ${platformLabel(p)}`
							: state === "owned"
								? `Install with ${platformLabel(p)}`
								: platformLabel(p);
					const tooltip =
						state === "disabled"
							? `Not in your ${platformLabel(p)} library`
							: state === "owned"
								? p === "gog"
									? `Owned on GOG but not installed — opens the game's page in GOG Galaxy where you can install`
									: `Owned on ${platformLabel(p)} but not installed — opens the ${platformLabel(p)} install flow`
								: `Launch via ${platformLabel(p)}`;
					return (
						<button
							key={p}
							type="button"
							disabled={state === "disabled"}
							onClick={() => onAction(p)}
							title={tooltip}
							className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
								state === "installed"
									? "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500"
									: state === "owned"
										? "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700"
										: "bg-zinc-950 text-zinc-600 border-zinc-900 cursor-not-allowed"
							}`}
						>
							{state === "installed" && (
								<span className="mr-1.5 text-emerald-300">●</span>
							)}
							{label}
						</button>
					);
				})}
			</div>
		</section>
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
			<div className="flex items-center gap-3 flex-wrap">
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

function VideoEmbed({
	video,
}: {
	video: GameDetailType["videos"][number];
}) {
	const [loaded, setLoaded] = useState(false);
	return (
		<div className="rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800">
			<div className="relative aspect-video bg-zinc-800">
				{!loaded ? (
					<button
						type="button"
						onClick={() => setLoaded(true)}
						className="absolute inset-0 group"
						aria-label={`Play video: ${video.title}`}
					>
						{video.thumbnail_url && (
							<img
								src={video.thumbnail_url}
								alt={video.title}
								className="w-full h-full object-cover"
							/>
						)}
						<div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/10 transition-colors">
							<div className="w-14 h-14 rounded-full bg-red-600/90 group-hover:bg-red-600 flex items-center justify-center">
								<span className="text-white text-2xl ml-1">▶</span>
							</div>
						</div>
					</button>
				) : (
					<iframe
						src={`https://www.youtube.com/embed/${video.video_id}?autoplay=1`}
						title={video.title}
						className="w-full h-full"
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
						allowFullScreen
					/>
				)}
			</div>
			<div className="p-3">
				<div className="text-sm text-zinc-100 line-clamp-2 leading-tight">
					{video.title}
				</div>
				<div className="text-xs text-zinc-500 mt-1 truncate">
					{video.channel}
				</div>
			</div>
		</div>
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
				<GameImage
					appid={game.appid}
					name={game.name}
					variant="library_capsule"
					fallback={game.header_image}
					className="w-full aspect-[2/3] object-cover bg-zinc-900"
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

function platformLabel(p: Platform): string {
	if (p === "steam") return "Steam";
	if (p === "epic") return "Epic";
	if (p === "gog") return "GOG";
	return p;
}
