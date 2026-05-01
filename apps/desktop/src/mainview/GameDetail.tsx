import { useEffect, useState } from 'react';
import type { InstalledIndex, Platform } from '../shared/types';
import { GameImage } from './GameImage';
import {
	api,
	type ExternalScore,
	type GameDetail as GameDetailType,
	type LibraryGame,
	type ListSummary,
	notifyListsChanged,
	type Screenshot,
	type SteamUserReview,
} from './lib/api';
import { getAlwaysShowRefreshIcons } from './lib/prefs';
import { rpc } from './lib/rpc';

/** Recent-release window for showing the refresh icon by default. */
const RECENT_RELEASE_DAYS = 14;

function isRecentRelease(release_date: string | null): boolean {
	if (!release_date) return false;
	const t = Date.parse(release_date);
	if (Number.isNaN(t)) return false;
	const ageDays = (Date.now() - t) / (1000 * 60 * 60 * 24);
	return ageDays >= 0 && ageDays <= RECENT_RELEASE_DAYS;
}

/**
 * Per-source refresh state — busy flag, kick-off, last result string.
 * Each instance fires only the source it was constructed with so the user
 * doesn't burn unrelated rate budgets (e.g. clicking Fetch in Critic
 * scores no longer hits YouTube quota).
 *
 * Use one `useRefresh(appid, 'X', onUpdated)` per section. The header
 * "refresh everything" icon uses `source='all'`.
 */
type RefreshSource =
	| 'all'
	| 'steam_appdetails'
	| 'steam_reviews'
	| 'opencritic'
	| 'youtube';

function useRefresh(
	appid: number,
	source: RefreshSource,
	onUpdated: () => void | Promise<void>,
) {
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<string | null>(null);

	// Reset transient state on game-switch — otherwise the previous game's
	// "youtube: rate_limited" line lingers on the new game's card.
	// biome-ignore lint/correctness/useExhaustiveDependencies: deliberate reset on appid only
	useEffect(() => {
		setBusy(false);
		setResult(null);
	}, [appid]);

	async function run() {
		setBusy(true);
		setResult(null);
		try {
			// Direct API call — skips the Electrobun RPC hop that imposes a
			// short default timeout. Steam appdetails refresh can take
			// 5-15s due to the upstream rate-limit sleeps in enrichOne.
			const r = await api.refreshGame(appid, source);
			// One-line summary; surface error/rate-limit detail since the
			// status alone ("error") isn't actionable.
			setResult(
				Object.entries(r.sources)
					.map(([k, v]) => {
						if (v.status === 'ok' || v.status === 'not_listed') {
							return `${k}: ${v.status}`;
						}
						const detail =
							typeof v.detail === 'string'
								? v.detail
								: v.detail
									? JSON.stringify(v.detail)
									: '';
						return detail
							? `${k}: ${v.status} — ${detail}`
							: `${k}: ${v.status}`;
					})
					.join(' · ') || 'done',
			);
			await onUpdated();
		} catch (e) {
			setResult(`error: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy(false);
		}
	}

	return { busy, result, run };
}

function RefreshIcon({
	visible,
	busy,
	onClick,
	title,
}: {
	visible: boolean;
	busy: boolean;
	onClick: () => void;
	title: string;
}) {
	if (!visible) return null;
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={busy}
			title={title}
			className="text-zinc-500 hover:text-zinc-200 disabled:opacity-50 ml-1.5 px-1 leading-none"
		>
			<span aria-hidden className={busy ? 'inline-block animate-spin' : ''}>
				↻
			</span>
		</button>
	);
}

interface Props {
	appid: number;
	installed: InstalledIndex | null;
	canBack: boolean;
	onBack: () => void;
	onNavigate: (appid: number) => void;
	onLoaded?: (name: string | null) => void;
	onSearch?: (query: string) => void;
}

export function GameDetail({
	appid,
	installed,
	canBack,
	onBack,
	onNavigate,
	onLoaded,
	onSearch,
}: Props) {
	const [game, setGame] = useState<GameDetailType | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [vectorSimilar, setVectorSimilar] = useState<LibraryGame[] | null>(
		null,
	);
	const [alwaysShowRefresh, setAlwaysShowRefresh] = useState(
		getAlwaysShowRefreshIcons,
	);
	useEffect(() => {
		const onChange = () => setAlwaysShowRefresh(getAlwaysShowRefreshIcons());
		window.addEventListener('seg:prefs:always-refresh-icons', onChange);
		return () =>
			window.removeEventListener('seg:prefs:always-refresh-icons', onChange);
	}, []);
	const reload = async () => {
		const updated = await api.game(appid);
		setGame(updated);
	};
	// One per section so each has independent busy/result state and only
	// fires its own source. The header ↻ uses 'all' to refresh everything.
	const refreshAll = useRefresh(appid, 'all', reload);
	const refreshScreens = useRefresh(appid, 'steam_appdetails', reload);
	const refreshReviews = useRefresh(appid, 'steam_reviews', reload);
	const refreshOC = useRefresh(appid, 'opencritic', reload);
	const refreshYT = useRefresh(appid, 'youtube', reload);
	const showRefreshIcon =
		alwaysShowRefresh || isRecentRelease(game?.release_date ?? null);
	useEffect(() => {
		const ctrl = new AbortController();
		setGame(null);
		setError(null);
		setVectorSimilar(null);
		api
			.game(appid, ctrl.signal)
			.then((g) => {
				setGame(g);
				onLoaded?.(g.name);
			})
			.catch((e) => {
				if (e.name !== 'AbortError') setError(`Load failed: ${e.message}`);
			});
		api
			.similar({ appid, limit: 12 }, ctrl.signal)
			.then((d) => setVectorSimilar(d.results))
			.catch((e) => {
				if (e.name !== 'AbortError') console.warn('similar failed', e);
			});
		return () => ctrl.abort();
	}, [appid, onLoaded]);

	async function handleLaunchAction(platform: Platform) {
		if (!game) return;
		const owned = game.platforms.includes(platform);
		if (!owned) return;
		const ownership = game.ownership.find((o) => o.platform === platform);
		const externalId = ownership?.external_id ?? String(game.appid);
		const isInstalledHere = isInstalledFor(installed, platform, game);

		if (!isInstalledHere) {
			const installUri =
				platform === 'steam'
					? `steam://install/${game.appid}`
					: platform === 'epic'
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
		if (!result.ok) console.error('launch failed:', result.error);
	}

	const releaseYear =
		game?.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
	const positivePct = game ? positivePctOf(game) : null;
	const topTags = game?.tags.slice(0, 12) ?? [];

	return (
		<div className="-mx-6 -mt-6">
			{/* Hero */}
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

				{canBack && (
					<button
						type="button"
						onClick={onBack}
						title="Back (Alt+Left, Backspace, mouse XButton1)"
						className="absolute top-6 left-6 z-10 px-2.5 py-1 rounded-md bg-zinc-800/90 hover:bg-zinc-700 backdrop-blur-sm border border-zinc-700 text-xs font-medium text-zinc-100 flex items-center gap-1 shadow-lg transition-colors"
					>
						<span aria-hidden>←</span>
						<span>Back</span>
					</button>
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
									<span>{game.developers.join(', ')}</span>
								</>
							)}
							{game?.genres && game.genres.length > 0 && (
								<>
									<span className="opacity-50">·</span>
									<span>{game.genres.slice(0, 3).join(' / ')}</span>
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
								{/* Description + tags moved to the right sidebar so all
								    metadata sits together and the wide column is just media
								    (screenshots, reviews). */}
								<section>
									{/* No section title — a row of game screenshots is
									    self-explanatory. Refresh affordance still lives
									    inside the empty-state placeholder when relevant. */}
									{showRefreshIcon &&
										game.screenshots &&
										game.screenshots.length > 0 && (
											<div className="flex justify-end mb-1">
												<RefreshIcon
													visible
													busy={refreshScreens.busy}
													onClick={refreshScreens.run}
													title="Re-fetch screenshots + Steam appdetails"
												/>
											</div>
										)}
									{game.screenshots && game.screenshots.length > 0 ? (
										<ScreenshotsGrid screenshots={game.screenshots} />
									) : (
										<PendingPlaceholder
											pending={game.screenshots_fetched_at === null}
											pendingText="Screenshots haven't been fetched yet — the enricher will pick this game up within the next few hours."
											emptyText="Steam returned no screenshots for this title."
											onFetchNow={refreshScreens.run}
											busy={refreshScreens.busy}
											result={refreshScreens.result}
										/>
									)}
								</section>

								<section>
									{/* Videos sit right under screenshots; same titleless
									    treatment since YouTube thumbnails are recognizable. */}
									{showRefreshIcon && game.videos.length > 0 && (
										<div className="flex justify-end mb-1">
											<RefreshIcon
												visible
												busy={refreshYT.busy}
												onClick={refreshYT.run}
												title="Re-fetch YouTube videos for this game"
											/>
										</div>
									)}
									{game.videos.length > 0 ? (
										<VideosGrid videos={game.videos} />
									) : (
										<PendingPlaceholder
											pending={game.youtube_fetched_at === null}
											pendingText="The YouTube cron processes ~90 games/day (newest first), leaving ~10 quota slots free for manual fetches like this one."
											emptyText="The previous fetch returned no videos. You can try again — sometimes new uploads appear."
											onFetchNow={refreshYT.run}
											busy={refreshYT.busy}
											result={refreshYT.result}
										/>
									)}
								</section>

								<section>
									<div className="flex items-baseline justify-between mb-2">
										<h3 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold flex items-center">
											Steam reviews
											<RefreshIcon
												visible={showRefreshIcon}
												busy={refreshReviews.busy}
												onClick={refreshReviews.run}
												title="Re-fetch Steam user reviews"
											/>
										</h3>
										{game.reviews && game.reviews.length > 0 && (
											<button
												type="button"
												onClick={() =>
													rpc.request.openUrl({
														url: `https://steamcommunity.com/app/${game.appid}/reviews/`,
													})
												}
												className="text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
											>
												All on Steam →
											</button>
										)}
									</div>
									{game.reviews && game.reviews.length > 0 ? (
										<ReviewsSection
											reviews={game.reviews}
											appid={game.appid}
										/>
									) : (
										<PendingPlaceholder
											pending={game.steam_reviews_fetched_at === null}
											pendingText="Steam user reviews will appear after the next enrichment pass (every 15 min, oldest-missing first)."
											emptyText="No English Steam reviews available for this title."
											onFetchNow={refreshReviews.run}
											busy={refreshReviews.busy}
											result={refreshReviews.result}
										/>
									)}
								</section>
							</div>

							<div className="space-y-6">
								{game.short_desc && (
									<section>
										<p className="text-sm text-zinc-200 leading-relaxed">
											{game.short_desc}
										</p>
									</section>
								)}
								{topTags.length > 0 && (
									<TagsSection tags={topTags} onSearch={onSearch} />
								)}
								<CriticScoresSection
									game={game}
									positivePct={positivePct}
									showRefreshIcon={showRefreshIcon}
									refreshOC={refreshOC}
								/>
								<StatsRow game={game} />
								<GameInfoSection game={game} />
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
								<h3 className="text-base font-semibold">
									Steam's "more like this"
								</h3>
								<p className="text-xs text-zinc-500 font-normal mb-3">
									From Steam's per-game recommendation graph, filtered to games
									you own.
								</p>
								<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
									{game.similar
										.filter((s) => s.header_image)
										.slice(0, 12)
										.map((s) => (
											<button
												key={s.appid}
												type="button"
												onClick={() => onNavigate(s.appid)}
												className="relative text-left rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors"
											>
												{s.header_image && (
													<img
														src={s.header_image}
														alt={s.name ?? ''}
														className="w-full"
													/>
												)}
												<div className="p-2 text-xs text-zinc-200 truncate">
													{s.name}
												</div>
												{s.platforms && s.platforms.length > 0 && (
													<div className="absolute top-1.5 left-1.5 flex gap-1">
														{s.platforms.map((p) => (
															<span
																key={p}
																title={
																	p === 'steam'
																		? 'Owned on Steam'
																		: p === 'epic'
																			? 'Owned on Epic'
																			: 'Owned on GOG'
																}
																className="text-[10px] leading-none px-1 py-0.5 rounded bg-zinc-950/80 backdrop-blur-sm border border-zinc-800"
															>
																{p === 'steam'
																	? '🟦'
																	: p === 'epic'
																		? '⚫'
																		: '🟣'}
															</span>
														))}
													</div>
												)}
											</button>
										))}
								</div>
							</section>
						)}

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
	const platforms: Platform[] = ['steam', 'epic', 'gog'];
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
						? 'disabled'
						: installedHere
							? 'installed'
							: 'owned';
					const label =
						state === 'installed'
							? `Launch on ${platformLabel(p)}`
							: state === 'owned'
								? `Install with ${platformLabel(p)}`
								: platformLabel(p);
					const tooltip =
						state === 'disabled'
							? `Not in your ${platformLabel(p)} library`
							: state === 'owned'
								? p === 'gog'
									? `Owned on GOG but not installed — opens the game's page in GOG Galaxy where you can install`
									: `Owned on ${platformLabel(p)} but not installed — opens the ${platformLabel(p)} install flow`
								: `Launch via ${platformLabel(p)}`;
					return (
						<button
							key={p}
							type="button"
							disabled={state === 'disabled'}
							onClick={() => onAction(p)}
							title={tooltip}
							className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
								state === 'installed'
									? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500'
									: state === 'owned'
										? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700'
										: 'bg-zinc-950 text-zinc-600 border-zinc-900 cursor-not-allowed'
							}`}
						>
							{state === 'installed' && (
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
	memberOf: GameDetailType['lists'];
	onChange: () => void | Promise<void>;
}) {
	const [allLists, setAllLists] = useState<ListSummary[] | null>(null);
	const [showPicker, setShowPicker] = useState(false);
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState('');

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
		notifyListsChanged();
	}

	async function handleCreate() {
		if (!newName.trim()) return;
		const created = await api.createList(newName.trim());
		await api.addToList(created.id, appid);
		setNewName('');
		setCreating(false);
		await onChange();
		const refreshed = await api.lists();
		setAllLists(refreshed.lists);
		notifyListsChanged();
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
					{showPicker
						? 'Done'
						: memberOf.length > 0
							? 'Edit lists'
							: 'Add to list…'}
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
								<span className="w-4 text-center">{isMember ? '✓' : ''}</span>
								<span className="w-5 text-center">{l.emoji ?? '📋'}</span>
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
										if (e.key === 'Enter') void handleCreate();
										if (e.key === 'Escape') {
											setCreating(false);
											setNewName('');
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

function StatsRow({ game }: { game: GameDetailType }) {
	const items: { label: string; value: string }[] = [];
	if (game.hltb_main !== null)
		items.push({ label: 'Main story', value: `${game.hltb_main}h` });
	if (game.hltb_extra !== null)
		items.push({ label: '+ Extras', value: `${game.hltb_extra}h` });
	if (game.hltb_complete !== null)
		items.push({ label: '100%', value: `${game.hltb_complete}h` });
	if (game.playtime_min > 0)
		items.push({
			label: 'You played',
			value: `${Math.round(game.playtime_min / 60)}h`,
		});
	// Reviews % and Metacritic both moved to the dedicated Critic Scores
	// section so all score sources live together.

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

/**
 * Unified Critic Scores section. Pulls Metacritic from the games row
 * (always free, no API key) and merges with OpenCritic from
 * `external_scores` (only present if the user configured a RapidAPI key).
 *
 * Always renders the section header and the Metacritic entry if present.
 * OpenCritic line only shows when there's actual data OR no Metacritic
 * to fall back on (so users without a key don't see "OpenCritic needs key"
 * on every game, just on games where Metacritic also has nothing).
 */
function CriticScoresSection({
	game,
	positivePct,
	showRefreshIcon,
	refreshOC,
}: {
	game: GameDetailType;
	positivePct: number | null;
	showRefreshIcon: boolean;
	refreshOC: { busy: boolean; result: string | null; run: () => void };
}) {
	const ocScore = game.external_scores?.find((s) => s.source === 'opencritic');
	const hasMeta = game.metacritic !== null;
	const hasOC = !!ocScore;
	const hasSteam = positivePct !== null;
	const totalReviews =
		(game.positive ?? 0) + (game.negative ?? 0) || null;
	// Hide the OpenCritic placeholder noise when Metacritic OR Steam %
	// already gives the user a score signal. Only nag when there's
	// literally nothing.
	const showOCPlaceholder = !hasOC && !hasMeta && !hasSteam;

	return (
		<section>
			<h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold flex items-center">
				Scores
				<RefreshIcon
					visible={showRefreshIcon}
					busy={refreshOC.busy}
					onClick={refreshOC.run}
					title="Re-fetch OpenCritic score"
				/>
			</h3>
			<div className="space-y-2">
				{hasSteam && (
					<SteamReviewScoreCard
						pct={positivePct as number}
						total={totalReviews}
						appid={game.appid}
					/>
				)}
				{hasMeta && (
					<MetacriticCard
						score={game.metacritic as number}
						url={game.metacritic_url}
					/>
				)}
				{hasOC && <ExternalScoresSection scores={[ocScore]} />}
			</div>
			{showOCPlaceholder && (
				<div className="mt-2">
					<PendingPlaceholder
						pending={game.opencritic_fetched_at === null}
						pendingText="No critic score yet. Click Fetch now to look this game up on OpenCritic."
						emptyText="No critic scores available for this title."
						onFetchNow={refreshOC.run}
						busy={refreshOC.busy}
						result={refreshOC.result}
					/>
				</div>
			)}
		</section>
	);
}

function SteamReviewScoreCard({
	pct,
	total,
	appid,
}: {
	pct: number;
	total: number | null;
	appid: number;
}) {
	const tier =
		pct >= 95
			? 'Overwhelmingly Positive'
			: pct >= 80
				? 'Very Positive'
				: pct >= 70
					? 'Mostly Positive'
					: pct >= 40
						? 'Mixed'
						: pct >= 20
							? 'Mostly Negative'
							: 'Overwhelmingly Negative';
	const tierClass =
		pct >= 70
			? 'text-emerald-400'
			: pct >= 40
				? 'text-amber-400'
				: 'text-red-400';
	return (
		<button
			type="button"
			onClick={() =>
				rpc.request.openUrl({
					url: `https://steamcommunity.com/app/${appid}/reviews/`,
				})
			}
			title="Open Steam reviews page"
			className="w-full text-left bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-md py-2 px-3 transition-colors"
		>
			<div className="flex items-baseline gap-2">
				<span className="text-[10px] uppercase tracking-wider text-zinc-500">
					Steam reviews
				</span>
				<span
					className={`text-[9px] uppercase tracking-wider ${tierClass}`}
				>
					{tier}
				</span>
			</div>
			<div className="mt-0.5 flex items-baseline gap-2">
				<span className="text-lg font-semibold tabular-nums text-zinc-100">
					{pct}%
				</span>
				{total !== null && (
					<span className="text-[11px] text-zinc-500">
						of {total.toLocaleString()} reviews
					</span>
				)}
			</div>
		</button>
	);
}

function TagsSection({
	tags,
	onSearch,
}: {
	tags: { tag: string; votes: number }[];
	onSearch?: (query: string) => void;
}) {
	return (
		<section>
			<h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
				Tags
			</h3>
			<div className="flex flex-wrap gap-1.5">
				{tags.map((t) => (
					<button
						type="button"
						key={t.tag}
						onClick={() => onSearch?.(t.tag)}
						disabled={!onSearch}
						className="text-xs px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-700 hover:text-zinc-100 transition-colors disabled:hover:bg-zinc-900 disabled:hover:border-zinc-800 disabled:cursor-default"
						title={`Search for "${t.tag}" — ${t.votes.toLocaleString()} votes`}
					>
						{t.tag}
					</button>
				))}
			</div>
		</section>
	);
}

function GameInfoSection({ game }: { game: GameDetailType }) {
	const rows: { label: string; value: React.ReactNode }[] = [];

	if (game.developers && game.developers.length > 0) {
		rows.push({ label: 'Developer', value: game.developers.join(', ') });
	}
	if (game.publishers && game.publishers.length > 0) {
		rows.push({ label: 'Publisher', value: game.publishers.join(', ') });
	}

	if (game.controller) {
		rows.push({
			label: 'Controller',
			value: game.controller === 'full' ? 'Full support' : 'Partial support',
		});
	}

	if (game.os_support) {
		const platforms: string[] = [];
		if (game.os_support.windows) platforms.push('Windows');
		if (game.os_support.mac) platforms.push('macOS');
		if (game.os_support.linux) platforms.push('Linux');
		if (platforms.length > 0) {
			rows.push({ label: 'OS', value: platforms.join(' · ') });
		}
	}

	if (game.categories && game.categories.length > 0) {
		// Categories are Steam "features" (multiplayer, achievements, cloud saves…)
		// Wrap so the column stays narrow but shows all of them.
		rows.push({
			label: 'Features',
			value: (
				<div className="flex flex-wrap gap-x-1.5 gap-y-0.5">
					{game.categories.map((c, i) => (
						<span key={c}>
							{c}
							{i < (game.categories?.length ?? 0) - 1 ? ',' : ''}
						</span>
					))}
				</div>
			),
		});
	}

	if (game.website) {
		rows.push({
			label: 'Website',
			value: (
				<button
					type="button"
					onClick={() => rpc.request.openUrl({ url: game.website ?? '' })}
					className="text-emerald-400 hover:text-emerald-300 underline truncate text-left"
				>
					{game.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
				</button>
			),
		});
	}

	if (rows.length === 0) return null;

	return (
		<section>
			<h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
				Game info
			</h3>
			<dl className="bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3 text-xs space-y-1.5">
				{rows.map((r) => (
					<div key={r.label} className="grid grid-cols-[80px_1fr] gap-2">
						<dt className="text-zinc-500 uppercase tracking-wider text-[10px] pt-px">
							{r.label}
						</dt>
						<dd className="text-zinc-200 min-w-0 break-words">{r.value}</dd>
					</div>
				))}
			</dl>
		</section>
	);
}

function MetacriticCard({
	score,
	url,
}: {
	score: number;
	url: string | null;
}) {
	const inner = (
		<>
			<div className="flex items-baseline gap-2">
				<span className="text-[10px] uppercase tracking-wider text-zinc-500">
					Metacritic
				</span>
			</div>
			<div className="mt-0.5 flex items-baseline gap-2">
				<span className="text-lg font-semibold tabular-nums text-zinc-100">
					{score}
				</span>
				<span className="text-[11px] text-zinc-500">/100</span>
			</div>
		</>
	);
	return url ? (
		<button
			type="button"
			onClick={() => rpc.request.openUrl({ url })}
			className="w-full text-left bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-md py-2 px-3 transition-colors"
			title="Open on Metacritic"
		>
			{inner}
		</button>
	) : (
		<div className="bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3">
			{inner}
		</div>
	);
}

function ExternalScoresSection({ scores }: { scores: ExternalScore[] }) {
	return (
		<div className="space-y-2">
				{scores.map((s) => {
					const label = s.source === 'opencritic' ? 'OpenCritic' : s.source;
					const score =
						s.score !== null
							? `${Math.round(s.score)}${s.max_score === 100 ? '' : `/${s.max_score}`}`
							: '—';
					const sub: string[] = [];
					if (s.tier) sub.push(s.tier);
					if (s.percent_recommended !== null)
						sub.push(`${Math.round(s.percent_recommended)}% rec`);
					if (s.num_reviews !== null) sub.push(`${s.num_reviews} reviews`);
					const inner = (
						<>
							<div className="flex items-baseline gap-2">
								<span className="text-[10px] uppercase tracking-wider text-zinc-500">
									{label}
								</span>
								{s.tier && (
									<span className="text-[9px] uppercase tracking-wider text-emerald-400">
										{s.tier}
									</span>
								)}
							</div>
							<div className="mt-0.5 flex items-baseline gap-2">
								<span className="text-lg font-semibold tabular-nums text-zinc-100">
									{score}
								</span>
								{sub.length > 0 && (
									<span className="text-[11px] text-zinc-500">
										{sub.slice(s.tier ? 1 : 0).join(' · ')}
									</span>
								)}
							</div>
						</>
					);
					return s.url ? (
						<button
							type="button"
							key={s.source}
							onClick={() => rpc.request.openUrl({ url: s.url ?? '' })}
							className="w-full text-left bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-md py-2 px-3 transition-colors"
							title={`Open on ${label}`}
						>
							{inner}
						</button>
					) : (
						<div
							key={s.source}
							className="bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3"
						>
							{inner}
						</div>
					);
				})}
			</div>
	);
}

/**
 * Single source of truth for the "Show N more" affordance. Used by every
 * collapsible section (screenshots, videos, reviews) so the look + behavior
 * stay identical: text-button below the visible items, one-click reveal,
 * no toggle back.
 */
function RevealMore({
	hidden,
	onReveal,
}: {
	hidden: number;
	onReveal: () => void;
}) {
	if (hidden <= 0) return null;
	return (
		<button
			type="button"
			onClick={onReveal}
			className="mt-2 text-xs text-zinc-500 hover:text-zinc-300"
		>
			Show {hidden} more
		</button>
	);
}

/**
 * Constrained screenshot grid: 3-column responsive grid showing one row
 * (3 thumbnails) by default. If there are more, a "Show N more" button
 * reveals the rest. No horizontal scroll — keeps the detail page width
 * bounded by the parent column.
 */
function ScreenshotsGrid({ screenshots }: { screenshots: Screenshot[] }) {
	const [expanded, setExpanded] = useState(false);
	const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
	const PER_ROW = 3;
	const visible = expanded ? screenshots : screenshots.slice(0, PER_ROW);

	return (
		<div>
			<div className="grid grid-cols-3 gap-2">
				{visible.map((s, i) => (
					<button
						type="button"
						key={s.id}
						onClick={() => setLightboxIdx(i)}
						title="Open full-size"
						className="aspect-[16/9] rounded-md overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-zinc-700"
					>
						<img
							src={s.path_thumbnail}
							alt=""
							loading="lazy"
							className="w-full h-full object-cover"
						/>
					</button>
				))}
			</div>
			{!expanded && (
				<RevealMore
					hidden={screenshots.length - visible.length}
					onReveal={() => setExpanded(true)}
				/>
			)}
			{lightboxIdx !== null && (
				<Lightbox
					images={(expanded ? screenshots : visible).map((s) => s.path_full)}
					index={lightboxIdx}
					onChange={setLightboxIdx}
					onClose={() => setLightboxIdx(null)}
				/>
			)}
		</div>
	);
}

/**
 * Full-screen image viewer. Click image / Esc / X to close. Left/Right
 * arrows (and on-screen chevrons) loop forever through the image set.
 * Backdrop click also closes.
 */
function Lightbox({
	images,
	index,
	onChange,
	onClose,
}: {
	images: string[];
	index: number;
	onChange: (i: number) => void;
	onClose: () => void;
}) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
			else if (e.key === 'ArrowLeft')
				onChange((index - 1 + images.length) % images.length);
			else if (e.key === 'ArrowRight') onChange((index + 1) % images.length);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [index, images.length, onChange, onClose]);

	const prev = () => onChange((index - 1 + images.length) % images.length);
	const next = () => onChange((index + 1) % images.length);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: full-screen modal backdrop
		// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled by document-level Escape listener
		<div
			onClick={onClose}
			className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center"
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: image inside modal */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click handled */}
			<img
				src={images[index]}
				alt=""
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				className="max-w-[95vw] max-h-[95vh] object-contain cursor-pointer select-none"
			/>
			{images.length > 1 && (
				<>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							prev();
						}}
						aria-label="Previous"
						className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center text-3xl text-white/70 hover:text-white bg-black/30 hover:bg-black/50 rounded-full transition"
					>
						‹
					</button>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							next();
						}}
						aria-label="Next"
						className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center text-3xl text-white/70 hover:text-white bg-black/30 hover:bg-black/50 rounded-full transition"
					>
						›
					</button>
					<div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/60 tabular-nums bg-black/30 px-2 py-1 rounded">
						{index + 1} / {images.length}
					</div>
				</>
			)}
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				aria-label="Close"
				className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-2xl text-white/70 hover:text-white bg-black/30 hover:bg-black/50 rounded-full transition"
			>
				×
			</button>
		</div>
	);
}

function PendingPlaceholder({
	pending,
	pendingText,
	emptyText,
	onFetchNow,
	busy,
	result,
}: {
	pending: boolean;
	pendingText: React.ReactNode;
	emptyText: React.ReactNode;
	onFetchNow?: () => void;
	busy?: boolean;
	result?: string | null;
}) {
	return (
		<div className="rounded-md border border-dashed border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-500">
			<div className="flex items-start gap-3">
				<span aria-hidden className="text-zinc-600">
					{pending ? '⏳' : 'ℹ︎'}
				</span>
				<div className="flex-1 leading-relaxed">
					{pending ? pendingText : emptyText}
				</div>
				{onFetchNow && (
					<button
						type="button"
						onClick={onFetchNow}
						disabled={busy}
						className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium disabled:opacity-50 whitespace-nowrap"
					>
						{busy ? 'Fetching…' : 'Fetch now'}
					</button>
				)}
			</div>
			{result && (
				<div className="text-[11px] text-zinc-500 font-mono mt-1.5 ml-6">
					{result}
				</div>
			)}
		</div>
	);
}

function ReviewsSection({
	reviews,
	appid: _appid,
}: {
	reviews: SteamUserReview[];
	appid: number;
}) {
	const [expanded, setExpanded] = useState(false);
	const TOP = 3;
	const visible = expanded ? reviews : reviews.slice(0, TOP);
	return (
		<>
			<div className="space-y-2">
				{visible.map((r) => (
					<ReviewCard key={r.recommendation_id} r={r} />
				))}
			</div>
			{!expanded && (
				<RevealMore
					hidden={reviews.length - visible.length}
					onReveal={() => setExpanded(true)}
				/>
			)}
		</>
	);
}

function VideosGrid({ videos }: { videos: GameDetailType['videos'] }) {
	const [expanded, setExpanded] = useState(false);
	// One row of 2 visible by default; click "Show N more" to reveal the rest.
	const TOP = 2;
	const visible = expanded ? videos : videos.slice(0, TOP);
	return (
		<>
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
				{visible.map((v) => (
					<VideoEmbed key={v.video_id} video={v} />
				))}
			</div>
			{!expanded && (
				<RevealMore
					hidden={videos.length - visible.length}
					onReveal={() => setExpanded(true)}
				/>
			)}
		</>
	);
}

function ReviewCard({ r }: { r: SteamUserReview }) {
	const playtime =
		r.playtime_at_review_min !== null && r.playtime_at_review_min > 0
			? `${Math.round(r.playtime_at_review_min / 60)}h at review`
			: null;
	const date = r.timestamp_created
		? new Date(r.timestamp_created).toLocaleDateString()
		: null;
	return (
		<div className="rounded-md border border-zinc-800 bg-zinc-900 p-3">
			<div className="flex items-center gap-2 mb-1.5 text-xs">
				<span
					className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${
						r.voted_up
							? 'bg-emerald-700/30 text-emerald-300 border border-emerald-700/50'
							: 'bg-red-700/30 text-red-300 border border-red-700/50'
					}`}
				>
					{r.voted_up ? 'Recommended' : 'Not recommended'}
				</span>
				{playtime && (
					<span className="text-zinc-500 tabular-nums">{playtime}</span>
				)}
				{date && (
					<>
						<span className="text-zinc-700">·</span>
						<span className="text-zinc-500 tabular-nums">{date}</span>
					</>
				)}
				{r.votes_up > 0 && (
					<>
						<span className="text-zinc-700">·</span>
						<span className="text-zinc-500 tabular-nums">
							{r.votes_up.toLocaleString()} found helpful
						</span>
					</>
				)}
			</div>
			<p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap line-clamp-6">
				{r.review_text}
			</p>
		</div>
	);
}

function VideoEmbed({ video }: { video: GameDetailType['videos'][number] }) {
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
	if (platform === 'steam') return installed.steam.includes(game.appid);
	const ext = game.ownership.find((o) => o.platform === platform)?.external_id;
	if (!ext) return false;
	if (platform === 'epic') return installed.epic.includes(ext);
	if (platform === 'gog') return installed.gog.includes(ext);
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
	if (p === 'steam') return 'Steam';
	if (p === 'epic') return 'Epic';
	if (p === 'gog') return 'GOG';
	return p;
}
