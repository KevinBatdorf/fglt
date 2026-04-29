import { useEffect, useState } from "react";
import { type ListSummary, api } from "./lib/api";
import type { Platform } from "../shared/types";

export type View =
	| { kind: "home" }
	| { kind: "search"; query: string }
	| { kind: "filter"; what: "all" | "unplayed" | "recently_played" | "recently_added" }
	| { kind: "discover"; what: "trending" | "random" | "recommended" }
	| { kind: "platform"; platform: Platform }
	| { kind: "list"; slug: string }
	| { kind: "settings" }
	| { kind: "detail"; appid: number };

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
	const [creatingList, setCreatingList] = useState(false);
	const [newListName, setNewListName] = useState("");

	useEffect(() => {
		api.lists().then((d) => setLists(d.lists));
	}, []);

	useEffect(() => {
		if (view.kind === "list") {
			api.lists().then((d) => setLists(d.lists));
		}
	}, [view]);

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
			setNewListName("");
			setCreatingList(false);
			if (navigateAfter) {
				onNavigate({ kind: "list", slug: created.slug });
			}
		} catch (e) {
			console.error("create list failed:", e);
		}
	}

	return (
		<aside className="w-56 shrink-0 h-screen sticky top-0 border-r border-zinc-800 bg-zinc-925 flex flex-col">
			<nav className="flex-1 overflow-y-auto py-3">
				<Section title="Library">
					<NavItem
						active={view.kind === "home"}
						onClick={() => onNavigate({ kind: "home" })}
						icon="🏠"
						label="Home"
					/>
					<NavItem
						active={view.kind === "filter" && view.what === "all"}
						onClick={() => onNavigate({ kind: "filter", what: "all" })}
						icon="📚"
						label="All games"
					/>
					<NavItem
						active={view.kind === "discover" && view.what === "trending"}
						onClick={() => onNavigate({ kind: "discover", what: "trending" })}
						icon="🔥"
						label="Trending"
					/>
					<NavItem
						active={view.kind === "discover" && view.what === "recommended"}
						onClick={() => onNavigate({ kind: "discover", what: "recommended" })}
						icon="✨"
						label="Recommended"
					/>
					<NavItem
						active={view.kind === "discover" && view.what === "random"}
						onClick={() => onNavigate({ kind: "discover", what: "random" })}
						icon="🎲"
						label="Random"
					/>
					<NavItem
						active={view.kind === "filter" && view.what === "unplayed"}
						onClick={() => onNavigate({ kind: "filter", what: "unplayed" })}
						icon="📥"
						label="Unplayed"
					/>
					<NavItem
						active={view.kind === "filter" && view.what === "recently_played"}
						onClick={() =>
							onNavigate({ kind: "filter", what: "recently_played" })
						}
						icon="🕒"
						label="Recently played"
					/>
					<NavItem
						active={view.kind === "filter" && view.what === "recently_added"}
						onClick={() =>
							onNavigate({ kind: "filter", what: "recently_added" })
						}
						icon="🆕"
						label="Recently added"
					/>
				</Section>

				<Section title="Platforms">
					{(["steam", "epic", "gog"] as Platform[]).map((p) => (
						<NavItem
							key={p}
							active={view.kind === "platform" && view.platform === p}
							onClick={() => onNavigate({ kind: "platform", platform: p })}
							icon={p === "steam" ? "🟦" : p === "epic" ? "⚫" : "🟣"}
							label={p === "steam" ? "Steam" : p === "epic" ? "Epic Games" : "GOG"}
							count={platformCounts[p]}
						/>
					))}
				</Section>

				<Section
					title="Lists"
					action={
						<SectionAction
							onClick={() => setCreatingList((v) => !v)}
							title={creatingList ? "Cancel" : "Create new list"}
						>
							{creatingList ? "Cancel" : "+ New"}
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
									if (e.key === "Enter") void handleCreateList(true);
									if (e.key === "Escape") {
										setCreatingList(false);
										setNewListName("");
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
						const active = view.kind === "list" && view.slug === l.slug;
						return (
							<NavItem
								key={l.id}
								active={active}
								onClick={() => onNavigate({ kind: "list", slug: l.slug })}
								icon={l.emoji ?? "📋"}
								label={l.name}
								count={l.count ?? 0}
							/>
						);
					})}
					{lists?.length === 0 && !creatingList && (
						<div className="px-4 py-1 text-xs text-zinc-600">No lists yet</div>
					)}
				</Section>

				{recentSearches.length > 0 && (
					<Section
						title="Recent searches"
						action={
							<SectionAction onClick={onClearRecent} title="Clear recent searches">
								Clear
							</SectionAction>
						}
					>
						{recentSearches.map((q) => {
						const active = view.kind === "search" && view.query === q;
						return (
							<NavItem
								key={q}
								active={active}
								onClick={() => onNavigate({ kind: "search", query: q })}
								icon="🔎"
								label={q}
							/>
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
					onClick={() => onNavigate({ kind: "settings" })}
					className={`w-full h-12 px-3 flex items-center gap-2.5 text-sm text-left transition-colors ${
						view.kind === "settings"
							? "bg-zinc-800 text-zinc-100"
							: "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
					}`}
				>
					<span className="w-5 text-center text-base leading-none">⚙</span>
					<span className="flex-1 truncate">Settings</span>
				</button>
			</div>
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
	icon,
	label,
	count,
}: {
	active: boolean;
	onClick: () => void;
	icon: string;
	label: string;
	count?: number;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full h-8 px-3 flex items-center gap-2.5 text-sm text-left transition-colors ${
				active
					? "bg-zinc-800 text-zinc-100"
					: "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
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
