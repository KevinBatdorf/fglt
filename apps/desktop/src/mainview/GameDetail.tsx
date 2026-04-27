import { useEffect, useState } from "react";
import {
	type GameDetail as GameDetailType,
	type ListSummary,
	api,
	steamImg,
} from "./lib/api";
import { rpc } from "./lib/rpc";
import type { InstalledIndex, Platform } from "../shared/types";

interface Props {
	appid: number;
	installed: InstalledIndex | null;
	onClose: () => void;
}

/**
 * Full-height drawer that slides in from the right with a backdrop.
 * Doesn't push the underlying grid (so no page squeeze).
 */
export function GameDetail({ appid, installed, onClose }: Props) {
	const [game, setGame] = useState<GameDetailType | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [refreshResult, setRefreshResult] = useState<string | null>(null);

	useEffect(() => {
		const ctrl = new AbortController();
		setGame(null);
		setError(null);
		api
			.game(appid, ctrl.signal)
			.then(setGame)
			.catch((e) => {
				if (e.name !== "AbortError") setError(`Load failed: ${e.message}`);
			});
		return () => ctrl.abort();
	}, [appid]);

	useEffect(() => {
		const handle = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handle);
		return () => window.removeEventListener("keydown", handle);
	}, [onClose]);

	const installedPlatforms =
		game !== null
			? game.platforms.filter((p) => isInstalledFor(installed, p, game))
			: [];
	const positivePct = game ? positivePctOf(game) : null;
	const launchPlatform = installedPlatforms[0] ?? game?.platforms[0];

	async function handleLaunch(platform: Platform, action: "run" | "install") {
		if (!game) return;
		// `install` only makes sense for Steam (steam://install/<appid>); other
		// stores fall back to the regular launch URI which lands the user on
		// the game's storefront page when not installed.
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

	const heroSrc = game ? steamImg(game.appid, "library_hero") : null;

	return (
		<>
			{/* Backdrop */}
			<button
				type="button"
				aria-label="Close detail"
				onClick={onClose}
				className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
			/>
			{/* Drawer */}
			<aside className="fixed top-0 right-0 z-50 h-screen w-[min(560px,92vw)] bg-zinc-950 border-l border-zinc-800 overflow-y-auto shadow-2xl">
				{error && (
					<div className="p-6">
						<div className="text-red-400 text-sm">{error}</div>
						<button
							type="button"
							onClick={onClose}
							className="mt-4 text-xs text-zinc-400 hover:text-zinc-200"
						>
							Close
						</button>
					</div>
				)}

				{!game && !error && (
					<div className="p-6 text-zinc-500 text-sm">Loading…</div>
				)}

				{game && (
					<div>
						<div className="relative">
							{heroSrc && (
								<img
									src={heroSrc}
									alt={game.name}
									className="w-full aspect-[1920/620] object-cover"
									onError={(e) => {
										if (game.header_image && e.currentTarget.src !== game.header_image) {
											e.currentTarget.src = game.header_image;
										}
									}}
								/>
							)}
							<div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent" />
							<button
								type="button"
								onClick={onClose}
								className="absolute top-3 right-3 w-9 h-9 rounded-full bg-zinc-950/80 hover:bg-zinc-950 text-zinc-300 hover:text-white text-base"
								aria-label="Close detail"
							>
								✕
							</button>
							<div className="absolute bottom-0 left-0 right-0 p-5">
								<h2 className="text-2xl font-bold leading-tight drop-shadow-lg">
									{game.name}
								</h2>
								<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-300">
									{game.release_date && <span>{game.release_date}</span>}
									{game.developers && game.developers.length > 0 && (
										<>
											<span className="opacity-50">·</span>
											<span>{game.developers.join(", ")}</span>
										</>
									)}
								</div>
							</div>
						</div>

						<div className="p-5 space-y-5">
							<section>
								<div className="flex flex-wrap gap-1.5 mb-3">
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
														className="px-2.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs"
														title={`Launch on ${p}`}
													>
														{capitalize(p)}
													</button>
												))}
										<button
											type="button"
											onClick={handleRefresh}
											disabled={refreshing}
											className="ml-auto px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs disabled:opacity-50"
										>
											{refreshing ? "Refreshing…" : "Refresh"}
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

							{game.short_desc && (
								<section>
									<p className="text-sm text-zinc-300 leading-relaxed">
										{game.short_desc}
									</p>
								</section>
							)}

							<StatsRow game={game} positivePct={positivePct} />

							{game.tags.length > 0 && (
								<section>
									<h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
										Tags
									</h3>
									<div className="flex flex-wrap gap-1">
										{game.tags.slice(0, 15).map((t) => (
											<span
												key={t.tag}
												className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300"
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
									<h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
										Videos · {game.videos.length}
									</h3>
									<div className="grid grid-cols-2 gap-2">
										{game.videos.slice(0, 6).map((v) => (
											<VideoThumb key={v.video_id} video={v} />
										))}
									</div>
								</section>
							)}

							{game.similar.length > 0 && (
								<section>
									<h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
										Similar
									</h3>
									<div className="grid grid-cols-3 gap-2">
										{game.similar
											.filter((s) => s.header_image)
											.slice(0, 6)
											.map((s) => (
												<div
													key={s.appid}
													className="rounded overflow-hidden bg-zinc-900"
												>
													{s.header_image && (
														<img
															src={s.header_image}
															alt={s.name ?? ""}
															className="w-full"
														/>
													)}
													<div className="p-1.5 text-[11px] text-zinc-300 truncate">
														{s.name}
													</div>
												</div>
											))}
									</div>
								</section>
							)}

							{game.ownership.length > 0 && (
								<section className="pt-2 border-t border-zinc-800">
									<h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
										Ownership
									</h3>
									<ul className="space-y-1 text-xs text-zinc-400 font-mono">
										{game.ownership.map((o) => (
											<li
												key={o.platform}
												className="flex items-center justify-between"
											>
												<span>{o.platform}</span>
												<span className="text-zinc-600 truncate max-w-[60%]">
													{o.external_id}
												</span>
											</li>
										))}
									</ul>
								</section>
							)}
						</div>
					</div>
				)}
			</aside>
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
				className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-colors"
			>
				▶ Launch on {capitalize(platform)}
			</button>
		);
	}
	return (
		<button
			type="button"
			onClick={() => onLaunch("install")}
			className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-sm border border-zinc-700 transition-colors"
		>
			{platform === "steam"
				? "⤓ Install with Steam"
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
			<div className="flex items-center justify-between mb-2">
				<h3 className="text-[10px] uppercase tracking-wider text-zinc-500">
					Lists
				</h3>
				<button
					type="button"
					onClick={() => setShowPicker((v) => !v)}
					className="text-xs text-emerald-400 hover:text-emerald-300"
				>
					{showPicker ? "Done" : "Add to list…"}
				</button>
			</div>

			{memberOf.length > 0 && (
				<div className="flex flex-wrap gap-1.5 mb-2">
					{memberOf.map((l) => (
						<span
							key={l.id}
							className="text-xs px-2 py-0.5 rounded bg-emerald-900/50 border border-emerald-700/50 text-emerald-100"
						>
							{l.emoji && <span className="mr-1">{l.emoji}</span>}
							{l.name}
						</span>
					))}
				</div>
			)}

			{showPicker && allLists && (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 space-y-1">
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
			className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded font-medium ${
				installed
					? "bg-emerald-900/60 border border-emerald-700/60 text-emerald-200"
					: "bg-zinc-800 text-zinc-400"
			}`}
			title={installed ? "Installed on this machine" : "Owned but not installed"}
		>
			{installed && <span className="mr-1">●</span>}
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
		items.push({ label: "Main", value: `${game.hltb_main}h` });
	if (game.hltb_extra !== null)
		items.push({ label: "+Extras", value: `${game.hltb_extra}h` });
	if (game.hltb_complete !== null)
		items.push({ label: "100%", value: `${game.hltb_complete}h` });
	if (positivePct !== null)
		items.push({ label: "Reviews", value: `${positivePct}% pos` });
	if (game.metacritic !== null)
		items.push({ label: "MC", value: String(game.metacritic) });
	if (game.playtime_min > 0)
		items.push({
			label: "Played",
			value: `${Math.round(game.playtime_min / 60)}h`,
		});

	if (items.length === 0) return null;

	return (
		<section>
			<div className="grid grid-cols-3 gap-2 text-center">
				{items.map((it) => (
					<div key={it.label} className="bg-zinc-900 rounded-md py-2 px-2">
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
			className="text-left rounded overflow-hidden bg-zinc-900 hover:bg-zinc-800 transition-colors"
		>
			{video.thumbnail_url && (
				<img
					src={video.thumbnail_url}
					alt={video.title}
					className="w-full aspect-video object-cover"
				/>
			)}
			<div className="p-1.5">
				<div className="text-[11px] text-zinc-200 line-clamp-2 leading-tight">
					{video.title}
				</div>
				<div className="text-[10px] text-zinc-500 mt-0.5 truncate">
					{video.channel}
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
