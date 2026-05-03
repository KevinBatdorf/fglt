import { useEffect, useState } from 'react';
import type { Platform } from '../shared/types';
import { ContextMenu } from './ContextMenu';
import {
	api,
	type ListSummary,
	notifyListsChanged,
	notifySavedSearchesChanged,
	type SavedSearchSummary,
} from './lib/api';
import {
	getSidebarVisibility,
	type SidebarKey,
	type SidebarVisibility,
	setSidebarVisibility,
} from './lib/prefs';

export type View =
	| { kind: 'home' }
	| { kind: 'search'; query: string }
	| {
			kind: 'filter';
			what:
				| 'all'
				| 'unplayed'
				| 'recently_played'
				| 'recently_added'
				| 'weekend';
	  }
	| { kind: 'discover'; what: 'trending' | 'random' | 'recommended' }
	| { kind: 'platform'; platform: Platform }
	| { kind: 'list'; slug: string }
	| { kind: 'saved_search'; slug: string }
	| { kind: 'recently_viewed' }
	| { kind: 'settings' }
	| { kind: 'setup_guide' }
	| { kind: 'detail'; appid: number };

interface Props {
	view: View;
	onNavigate: (view: View) => void;
	recentSearches: string[];
	onClearRecent: () => void;
	platformCounts: Partial<Record<Platform, number>>;
	/**
	 * When true, every nav item except Settings and Setup guide is
	 * click-disabled and visually dimmed. Set when required config is
	 * missing OR the API is unreachable — the app can't actually do
	 * anything useful in those states, so we surface that.
	 */
	locked?: boolean;
}

export function Sidebar({
	view,
	onNavigate: navigateRaw,
	recentSearches,
	onClearRecent,
	platformCounts,
	locked = false,
}: Props) {
	// Wrap the parent-supplied navigate so we can intercept clicks while
	// the app is locked. Settings + Setup guide always go through; every
	// other destination is dropped on the floor (the visual disable below
	// makes that obvious to the user).
	const onNavigate = (next: View) => {
		if (locked && next.kind !== 'settings' && next.kind !== 'setup_guide') {
			return;
		}
		navigateRaw(next);
	};
	const [lists, setLists] = useState<ListSummary[] | null>(null);
	const [savedSearches, setSavedSearches] = useState<
		SavedSearchSummary[] | null
	>(null);
	const [creatingList, setCreatingList] = useState(false);
	const [newListName, setNewListName] = useState('');
	const [vis, setVis] = useState<SidebarVisibility>(getSidebarVisibility);
	const [listMenu, setListMenu] = useState<{
		x: number;
		y: number;
		list: ListSummary;
	} | null>(null);
	const [renamingListId, setRenamingListId] = useState<number | null>(null);
	const [renameValue, setRenameValue] = useState('');

	async function handleRenameSubmit(list: ListSummary) {
		const trimmed = renameValue.trim();
		if (!trimmed) {
			setRenamingListId(null);
			return;
		}
		// Same emoji-prefix convention as create — let the user re-set the
		// icon by editing the leading emoji in the name.
		const { emoji, name } = splitLeadingEmoji(trimmed);
		try {
			await api.renameList(list.slug, { name, emoji: emoji ?? null });
			const refreshed = await api.lists();
			setLists(refreshed.lists);
			notifyListsChanged();
		} catch (e) {
			console.error('rename failed:', e);
		} finally {
			setRenamingListId(null);
			setRenameValue('');
		}
	}

	const [savedMenu, setSavedMenu] = useState<{
		x: number;
		y: number;
		entry: SavedSearchSummary;
	} | null>(null);
	const [recentMenu, setRecentMenu] = useState<{
		x: number;
		y: number;
		query: string;
	} | null>(null);
	const [navItemMenu, setNavItemMenu] = useState<{
		x: number;
		y: number;
		key: SidebarKey;
		label: string;
	} | null>(null);

	function hideNavItem(key: SidebarKey) {
		setSidebarVisibility({ ...vis, [key]: false });
		setNavItemMenu(null);
	}
	// When the user picks "Save as Curated" or "Create list from results"
	// from the recent-searches context menu, we open an inline name input
	// instead of a modal — fits the rest of the sidebar.
	const [savePrompt, setSavePrompt] = useState<{
		query: string;
		mode: 'curated' | 'list';
		name: string;
	} | null>(null);

	async function commitSavePrompt() {
		if (!savePrompt) return;
		const name = savePrompt.name.trim();
		if (!name) {
			setSavePrompt(null);
			return;
		}
		try {
			if (savePrompt.mode === 'curated') {
				const created = await api.createSavedSearch({
					name,
					query: savePrompt.query,
				});
				notifySavedSearchesChanged();
				onNavigate({ kind: 'saved_search', slug: created.slug });
			} else {
				// Run the same hybrid search the SearchResults view uses,
				// then hand the appids to the server. Server-side FTS-only
				// search would miss vector-only matches for vibey queries.
				const lib = await api.library({
					q: savePrompt.query,
					limit: 5000,
				});
				const appids = lib.results.map((g) => g.appid);
				const created = await api.createListFromAppids(name, appids);
				notifyListsChanged();
				onNavigate({ kind: 'list', slug: created.slug });
			}
		} catch (e) {
			console.error('save flow failed:', e);
		} finally {
			setSavePrompt(null);
		}
	}

	async function handleDeleteSaved(entry: SavedSearchSummary) {
		setSavedMenu(null);
		try {
			await api.deleteSavedSearch(entry.slug);
			const refreshed = await api.savedSearches();
			setSavedSearches(refreshed.saved_searches);
			notifySavedSearchesChanged();
			if (view.kind === 'saved_search' && view.slug === entry.slug) {
				onNavigate({ kind: 'home' });
			}
		} catch (e) {
			console.error('delete saved search failed:', e);
		}
	}

	async function handleDeleteList(list: ListSummary) {
		setListMenu(null);
		try {
			await api.deleteList(list.slug);
			const refreshed = await api.lists();
			setLists(refreshed.lists);
			notifyListsChanged();
			if (view.kind === 'list' && view.slug === list.slug) {
				onNavigate({ kind: 'home' });
			}
		} catch (e) {
			// Server enforces "at least one list must remain" — surface the
			// rejection as an alert so the user knows why the delete didn't
			// happen instead of silently no-oping.
			const msg = e instanceof Error ? e.message : 'unknown';
			if (msg.includes('at least one list')) {
				alert(
					"Can't delete — at least one list must remain. Create a new list first, then delete this one.",
				);
			} else {
				console.error('delete list failed:', e);
			}
		}
	}

	useEffect(() => {
		const refreshLists = () => {
			api.lists().then((d) => setLists(d.lists));
		};
		const refreshSaved = () => {
			api.savedSearches().then((d) => setSavedSearches(d.saved_searches));
		};
		refreshLists();
		refreshSaved();
		const onPrefs = () => setVis(getSidebarVisibility());
		window.addEventListener('fglt:prefs:sidebar-toggled', onPrefs);
		window.addEventListener('fglt:lists:changed', refreshLists);
		window.addEventListener('fglt:saved-searches:changed', refreshSaved);
		return () => {
			window.removeEventListener('fglt:prefs:sidebar-toggled', onPrefs);
			window.removeEventListener('fglt:lists:changed', refreshLists);
			window.removeEventListener('fglt:saved-searches:changed', refreshSaved);
		};
	}, []);

	async function handleCreateList(navigateAfter: boolean) {
		const trimmed = newListName.trim();
		if (!trimmed) {
			setCreatingList(false);
			return;
		}
		// Lightweight emoji-as-prefix UX: if the input starts with an emoji
		// followed by whitespace (e.g. "🎮 Quick fun"), peel it off into the
		// emoji field so the list shows the user's chosen icon instead of
		// the default 📋. Falls back to plain name if no leading emoji.
		const { emoji, name } = splitLeadingEmoji(trimmed);
		try {
			const created = await api.createList(name, emoji);
			const refreshed = await api.lists();
			setLists(refreshed.lists);
			notifyListsChanged();
			setNewListName('');
			setCreatingList(false);
			if (navigateAfter) {
				onNavigate({ kind: 'list', slug: created.slug });
			}
		} catch (e) {
			console.error('create list failed:', e);
		}
	}

	// Render every nav button via this wrapper so the lockout `disabled`
	// prop can flip the whole sidebar in one place. (Settings is rendered
	// directly with its own button below.)
	const Item = (props: Omit<Parameters<typeof NavItem>[0], 'disabled'>) => (
		<NavItem {...props} disabled={locked} />
	);

	return (
		<aside className="w-56 shrink-0 self-stretch border-r border-zinc-800 bg-zinc-925 flex flex-col">
			<nav className="flex-1 overflow-y-auto py-3">
				<Section title="Library">
					<Item
						active={view.kind === 'home'}
						onClick={() => onNavigate({ kind: 'home' })}
						icon="🏠"
						label="Home"
					/>
					<Item
						active={view.kind === 'filter' && view.what === 'all'}
						onClick={() => onNavigate({ kind: 'filter', what: 'all' })}
						icon="📚"
						label="All games"
					/>
					{vis.trending && (
						<Item
							active={view.kind === 'discover' && view.what === 'trending'}
							onClick={() => onNavigate({ kind: 'discover', what: 'trending' })}
							onContextMenu={navHideContextMenu(
								'trending',
								'Trending',
								setNavItemMenu,
							)}
							icon="🔥"
							label="Trending"
						/>
					)}
					{vis.recommended && (
						<Item
							active={view.kind === 'discover' && view.what === 'recommended'}
							onClick={() =>
								onNavigate({ kind: 'discover', what: 'recommended' })
							}
							onContextMenu={navHideContextMenu(
								'recommended',
								'Recommended',
								setNavItemMenu,
							)}
							icon="✨"
							label="Recommended"
						/>
					)}
					{vis.random && (
						<Item
							active={view.kind === 'discover' && view.what === 'random'}
							onClick={() => onNavigate({ kind: 'discover', what: 'random' })}
							onContextMenu={navHideContextMenu(
								'random',
								'Random',
								setNavItemMenu,
							)}
							icon="🎲"
							label="Random"
						/>
					)}
					{vis.unplayed && (
						<Item
							active={view.kind === 'filter' && view.what === 'unplayed'}
							onClick={() => onNavigate({ kind: 'filter', what: 'unplayed' })}
							onContextMenu={navHideContextMenu(
								'unplayed',
								'Unplayed',
								setNavItemMenu,
							)}
							icon="📥"
							label="Unplayed"
						/>
					)}
					{vis.weekend && (
						<Item
							active={view.kind === 'filter' && view.what === 'weekend'}
							onClick={() => onNavigate({ kind: 'filter', what: 'weekend' })}
							onContextMenu={navHideContextMenu(
								'weekend',
								'Weekend games',
								setNavItemMenu,
							)}
							icon="🌅"
							label="Weekend games"
						/>
					)}
					{vis.recently_played && (
						<Item
							active={view.kind === 'filter' && view.what === 'recently_played'}
							onClick={() =>
								onNavigate({ kind: 'filter', what: 'recently_played' })
							}
							onContextMenu={navHideContextMenu(
								'recently_played',
								'Recently played',
								setNavItemMenu,
							)}
							icon="🕒"
							label="Recently played"
						/>
					)}
					{vis.recently_added && (
						<Item
							active={view.kind === 'filter' && view.what === 'recently_added'}
							onClick={() =>
								onNavigate({ kind: 'filter', what: 'recently_added' })
							}
							onContextMenu={navHideContextMenu(
								'recently_added',
								'Recently added',
								setNavItemMenu,
							)}
							icon="🆕"
							label="Recently added"
						/>
					)}
					{vis.recently_viewed && (
						<Item
							active={view.kind === 'recently_viewed'}
							onClick={() => onNavigate({ kind: 'recently_viewed' })}
							onContextMenu={navHideContextMenu(
								'recently_viewed',
								'Recently viewed',
								setNavItemMenu,
							)}
							icon="👁"
							label="Recently viewed"
						/>
					)}
				</Section>

				{savedSearches && savedSearches.length > 0 && (
					<Section title="Saved searches">
						{savedSearches.map((s) => {
							const active =
								view.kind === 'saved_search' && view.slug === s.slug;
							return (
								<Item
									key={s.id}
									active={active}
									onClick={() =>
										onNavigate({ kind: 'saved_search', slug: s.slug })
									}
									onContextMenu={(e) => {
										e.preventDefault();
										e.stopPropagation();
										setSavedMenu({
											x: e.clientX,
											y: e.clientY,
											entry: s,
										});
									}}
									icon={s.emoji ?? '🔖'}
									label={s.name}
								/>
							);
						})}
					</Section>
				)}

				{vis.platforms && (
					<Section title="Platforms">
						{(['steam', 'epic', 'gog'] as Platform[]).map((p) => (
							<Item
								key={p}
								active={view.kind === 'platform' && view.platform === p}
								onClick={() => onNavigate({ kind: 'platform', platform: p })}
								icon={p === 'steam' ? '🟦' : p === 'epic' ? '⚫' : '🟣'}
								label={
									p === 'steam' ? 'Steam' : p === 'epic' ? 'Epic Games' : 'GOG'
								}
								count={platformCounts[p]}
							/>
						))}
					</Section>
				)}

				{vis.lists && (
					<Section
						title="Lists"
						action={
							<SectionAction
								onClick={() => setCreatingList((v) => !v)}
								title={creatingList ? 'Cancel' : 'Create new list'}
							>
								{creatingList ? 'Cancel' : '+ New'}
							</SectionAction>
						}
					>
						{creatingList && (
							<div className="px-4 py-1.5">
								<input
									autoFocus
									type="text"
									value={newListName}
									onChange={(e) => setNewListName(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') void handleCreateList(true);
										if (e.key === 'Escape') {
											setCreatingList(false);
											setNewListName('');
										}
									}}
									onBlur={() => {
										if (newListName.trim()) void handleCreateList(false);
										else setCreatingList(false);
									}}
									placeholder="List name (start with an emoji to set an icon)"
									className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm focus:outline-none focus:border-zinc-600"
								/>
							</div>
						)}
						{lists?.map((l) => {
							const active = view.kind === 'list' && view.slug === l.slug;
							const isRenaming = renamingListId === l.id;
							if (isRenaming) {
								return (
									<div key={l.id} className="px-4 py-1.5">
										<input
											autoFocus
											type="text"
											value={renameValue}
											onChange={(e) => setRenameValue(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === 'Enter') void handleRenameSubmit(l);
												if (e.key === 'Escape') {
													setRenamingListId(null);
													setRenameValue('');
												}
											}}
											onBlur={() => {
												if (renameValue.trim()) void handleRenameSubmit(l);
												else setRenamingListId(null);
											}}
											placeholder="List name (emoji prefix sets icon)"
											className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm focus:outline-none focus:border-zinc-600"
										/>
									</div>
								);
							}
							return (
								<Item
									key={l.id}
									active={active}
									onClick={() => onNavigate({ kind: 'list', slug: l.slug })}
									onContextMenu={(e) => {
										e.preventDefault();
										e.stopPropagation();
										setListMenu({ x: e.clientX, y: e.clientY, list: l });
									}}
									icon={l.emoji ?? '📋'}
									label={l.name}
									count={l.count ?? 0}
								/>
							);
						})}
						{lists?.length === 0 && !creatingList && (
							<div className="px-4 py-1 text-xs text-zinc-600">
								No lists yet
							</div>
						)}
					</Section>
				)}

				{vis.recent_searches && recentSearches.length > 0 && (
					<Section
						title="Recent searches"
						action={
							<SectionAction
								onClick={onClearRecent}
								title="Clear recent searches"
							>
								Clear
							</SectionAction>
						}
					>
						{recentSearches.map((q) => {
							const active = view.kind === 'search' && view.query === q;
							const isPrompting = savePrompt?.query === q;
							return (
								<div key={q}>
									<Item
										active={active}
										onClick={() => onNavigate({ kind: 'search', query: q })}
										onContextMenu={(e) => {
											e.preventDefault();
											e.stopPropagation();
											setRecentMenu({
												x: e.clientX,
												y: e.clientY,
												query: q,
											});
										}}
										icon="🔎"
										label={q}
									/>
									{isPrompting && savePrompt && (
										<div className="px-4 py-1.5">
											<input
												autoFocus
												type="text"
												value={savePrompt.name}
												onChange={(e) =>
													setSavePrompt({
														...savePrompt,
														name: e.target.value,
													})
												}
												onKeyDown={(e) => {
													if (e.key === 'Enter') void commitSavePrompt();
													if (e.key === 'Escape') setSavePrompt(null);
												}}
												onBlur={() => {
													if (savePrompt.name.trim()) void commitSavePrompt();
													else setSavePrompt(null);
												}}
												placeholder={
													savePrompt.mode === 'curated'
														? 'Saved search name'
														: 'List name'
												}
												className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm focus:outline-none focus:border-zinc-600"
											/>
										</div>
									)}
								</div>
							);
						})}
					</Section>
				)}
			</nav>

			{/* Sticky bottom: Settings — button itself takes the full footer
			    height so the hover background fills edge-to-edge instead of
			    leaving a halo around an inset button. */}
			<div className="border-t border-zinc-800">
				<button
					type="button"
					onClick={() => onNavigate({ kind: 'settings' })}
					className={`w-full h-12 px-3 flex items-center gap-2.5 text-sm text-left transition-colors ${
						view.kind === 'settings'
							? 'bg-zinc-800 text-zinc-100'
							: 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
					}`}
				>
					<span className="w-5 text-center text-base leading-none">⚙</span>
					<span className="flex-1 truncate">Settings</span>
				</button>
			</div>

			{listMenu && (
				<ContextMenu
					x={listMenu.x}
					y={listMenu.y}
					onClose={() => setListMenu(null)}
					items={[
						{
							label: 'Rename',
							onClick: () => {
								setRenameValue(
									listMenu.list.emoji
										? `${listMenu.list.emoji} ${listMenu.list.name}`
										: listMenu.list.name,
								);
								setRenamingListId(listMenu.list.id);
							},
						},
						{
							label: `Delete "${listMenu.list.name}"`,
							onClick: () => handleDeleteList(listMenu.list),
							danger: true,
						},
					]}
				/>
			)}

			{savedMenu && (
				<ContextMenu
					x={savedMenu.x}
					y={savedMenu.y}
					onClose={() => setSavedMenu(null)}
					items={[
						{
							label: `Delete "${savedMenu.entry.name}"`,
							onClick: () => handleDeleteSaved(savedMenu.entry),
							danger: true,
						},
					]}
				/>
			)}

			{recentMenu && (
				<ContextMenu
					x={recentMenu.x}
					y={recentMenu.y}
					onClose={() => setRecentMenu(null)}
					items={[
						{
							label: 'Save search',
							onClick: () =>
								setSavePrompt({
									query: recentMenu.query,
									mode: 'curated',
									name: recentMenu.query,
								}),
						},
						{
							label: 'Create list from results',
							onClick: () =>
								setSavePrompt({
									query: recentMenu.query,
									mode: 'list',
									name: recentMenu.query,
								}),
						},
					]}
				/>
			)}

			{navItemMenu && (
				<ContextMenu
					x={navItemMenu.x}
					y={navItemMenu.y}
					onClose={() => setNavItemMenu(null)}
					items={[
						{
							label: `Hide "${navItemMenu.label}" from sidebar`,
							onClick: () => hideNavItem(navItemMenu.key),
							danger: true,
						},
					]}
				/>
			)}
		</aside>
	);
}

function SectionAction({
	onClick,
	title,
	children,
}: {
	onClick: () => void;
	title?: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			// preventDefault on mousedown stops the click from stealing
			// focus from any open input. Without it, clicking "Cancel"
			// while an inline create input is focused fires the input's
			// onBlur first (which sets state to closed), then the button's
			// onClick fires and toggles back to open.
			onMouseDown={(e) => e.preventDefault()}
			title={title}
			className="-mr-2 text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 rounded px-2 py-0.5 font-semibold"
		>
			{children}
		</button>
	);
}

function Section({
	title,
	action,
	children,
}: {
	title: string;
	action?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="mb-4">
			{/* Symmetric px-3 — same as NavItem. Action buttons that have
			    their own internal padding (e.g. the "+ New" pill) must apply
			    `-mr-2` themselves so their text aligns with NavItem `count`
			    labels. Plain text actions (like "clear") need nothing. */}
			<div className="px-3 h-7 flex items-center justify-between gap-2">
				<h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
					{title}
				</h3>
				{action}
			</div>
			<div className="space-y-px">{children}</div>
		</div>
	);
}

/**
 * If the string starts with one emoji glyph followed by whitespace,
 * return { emoji, name: rest }. Otherwise return { emoji: undefined, name }.
 * Uses the Unicode `\p{Extended_Pictographic}` property so flag/joiner
 * sequences and skin-tone modifiers all match cleanly.
 */
function splitLeadingEmoji(s: string): {
	emoji: string | undefined;
	name: string;
} {
	const m = s.match(
		/^(\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*️?)\s+(.+)$/u,
	);
	if (m) return { emoji: m[1], name: m[2].trim() };
	return { emoji: undefined, name: s };
}

/** Build a right-click handler that opens the "hide from sidebar" menu. */
function navHideContextMenu(
	key: SidebarKey,
	label: string,
	setMenu: (m: {
		x: number;
		y: number;
		key: SidebarKey;
		label: string;
	}) => void,
) {
	return (e: React.MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setMenu({ x: e.clientX, y: e.clientY, key, label });
	};
}

function NavItem({
	active,
	onClick,
	onContextMenu,
	icon,
	label,
	count,
	disabled = false,
}: {
	active: boolean;
	onClick: () => void;
	onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
	icon: string | null;
	label: string;
	count?: number;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={disabled ? undefined : onClick}
			onContextMenu={disabled ? undefined : onContextMenu}
			disabled={disabled}
			title={disabled ? 'Set required keys in Settings to unlock' : undefined}
			className={`w-full h-8 px-3 flex items-center gap-2.5 text-sm text-left transition-colors ${
				disabled
					? 'opacity-40 cursor-not-allowed text-zinc-500'
					: active
						? 'bg-zinc-800 text-zinc-100'
						: 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
			}`}
		>
			{icon !== null && (
				<span className="w-5 text-center text-sm leading-none">{icon}</span>
			)}
			<span className="flex-1 truncate">{label}</span>
			{count !== undefined && (
				<span className="text-[10px] text-zinc-500 tabular-nums">{count}</span>
			)}
		</button>
	);
}
