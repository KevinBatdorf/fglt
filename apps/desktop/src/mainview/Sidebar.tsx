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
import { getSidebarVisibility, type SidebarVisibility } from './lib/prefs';

export type View =
	| { kind: 'home' }
	| { kind: 'search'; query: string }
	| {
			kind: 'filter';
			what: 'all' | 'unplayed' | 'recently_played' | 'recently_added';
	  }
	| { kind: 'discover'; what: 'trending' | 'random' | 'recommended' }
	| { kind: 'platform'; platform: Platform }
	| { kind: 'list'; slug: string }
	| { kind: 'saved_search'; slug: string }
	| { kind: 'settings' }
	| { kind: 'detail'; appid: number };

interface Props {
	view: View;
	onNavigate: (view: View) => void;
	recentSearches: string[];
	onClearRecent: () => void;
	platformCounts: Partial<Record<Platform, number>>;
}

export function Sidebar({
	view,
	onNavigate,
	recentSearches,
	onClearRecent,
	platformCounts,
}: Props) {
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
			console.error('delete list failed:', e);
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
		window.addEventListener('seg:prefs:sidebar-toggled', onPrefs);
		window.addEventListener('seg:lists:changed', refreshLists);
		window.addEventListener('seg:saved-searches:changed', refreshSaved);
		return () => {
			window.removeEventListener('seg:prefs:sidebar-toggled', onPrefs);
			window.removeEventListener('seg:lists:changed', refreshLists);
			window.removeEventListener('seg:saved-searches:changed', refreshSaved);
		};
	}, []);

	async function handleCreateList(navigateAfter: boolean) {
		const name = newListName.trim();
		if (!name) {
			setCreatingList(false);
			return;
		}
		try {
			const created = await api.createList(name);
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

	return (
		<aside className="w-56 shrink-0 self-stretch border-r border-zinc-800 bg-zinc-925 flex flex-col">
			<nav className="flex-1 overflow-y-auto py-3">
				<Section title="Library">
					<NavItem
						active={view.kind === 'home'}
						onClick={() => onNavigate({ kind: 'home' })}
						icon="🏠"
						label="Home"
					/>
					<NavItem
						active={view.kind === 'filter' && view.what === 'all'}
						onClick={() => onNavigate({ kind: 'filter', what: 'all' })}
						icon="📚"
						label="All games"
					/>
					{vis.trending && (
						<NavItem
							active={view.kind === 'discover' && view.what === 'trending'}
							onClick={() => onNavigate({ kind: 'discover', what: 'trending' })}
							icon="🔥"
							label="Trending"
						/>
					)}
					{vis.recommended && (
						<NavItem
							active={view.kind === 'discover' && view.what === 'recommended'}
							onClick={() =>
								onNavigate({ kind: 'discover', what: 'recommended' })
							}
							icon="✨"
							label="Recommended"
						/>
					)}
					{vis.random && (
						<NavItem
							active={view.kind === 'discover' && view.what === 'random'}
							onClick={() => onNavigate({ kind: 'discover', what: 'random' })}
							icon="🎲"
							label="Random"
						/>
					)}
					{vis.unplayed && (
						<NavItem
							active={view.kind === 'filter' && view.what === 'unplayed'}
							onClick={() => onNavigate({ kind: 'filter', what: 'unplayed' })}
							icon="📥"
							label="Unplayed"
						/>
					)}
					{vis.recently_played && (
						<NavItem
							active={view.kind === 'filter' && view.what === 'recently_played'}
							onClick={() =>
								onNavigate({ kind: 'filter', what: 'recently_played' })
							}
							icon="🕒"
							label="Recently played"
						/>
					)}
					{vis.recently_added && (
						<NavItem
							active={view.kind === 'filter' && view.what === 'recently_added'}
							onClick={() =>
								onNavigate({ kind: 'filter', what: 'recently_added' })
							}
							icon="🆕"
							label="Recently added"
						/>
					)}
				</Section>

				{savedSearches && savedSearches.length > 0 && (
					<Section title="Saved searches">
						{savedSearches.map((s) => {
							const active =
								view.kind === 'saved_search' && view.slug === s.slug;
							return (
								<NavItem
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
							<NavItem
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
									placeholder="List name"
									className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm focus:outline-none focus:border-zinc-600"
								/>
							</div>
						)}
						{lists?.map((l) => {
							const active = view.kind === 'list' && view.slug === l.slug;
							return (
								<NavItem
									key={l.id}
									active={active}
									onClick={() => onNavigate({ kind: 'list', slug: l.slug })}
									onContextMenu={
										l.is_system
											? undefined
											: (e) => {
													e.preventDefault();
													e.stopPropagation();
													setListMenu({ x: e.clientX, y: e.clientY, list: l });
												}
									}
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
									<NavItem
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

function NavItem({
	active,
	onClick,
	onContextMenu,
	icon,
	label,
	count,
}: {
	active: boolean;
	onClick: () => void;
	onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
	icon: string;
	label: string;
	count?: number;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			onContextMenu={onContextMenu}
			className={`w-full h-8 px-3 flex items-center gap-2.5 text-sm text-left transition-colors ${
				active
					? 'bg-zinc-800 text-zinc-100'
					: 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
			}`}
		>
			<span className="w-5 text-center text-sm leading-none">{icon}</span>
			<span className="flex-1 truncate">{label}</span>
			{count !== undefined && (
				<span className="text-[10px] text-zinc-500 tabular-nums">{count}</span>
			)}
		</button>
	);
}
