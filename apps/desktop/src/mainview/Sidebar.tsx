import { useEffect, useState } from "react";
import { type ListSummary, api } from "./lib/api";

export type View =
	| { kind: "home" }
	| { kind: "search"; query: string }
	| { kind: "filter"; what: "unplayed" | "recent" }
	| { kind: "list"; slug: string };

interface Props {
	view: View;
	onNavigate: (view: View) => void;
	recentSearches: string[];
	onClearRecent: () => void;
}

export function Sidebar({
	view,
	onNavigate,
	recentSearches,
	onClearRecent,
}: Props) {
	const [lists, setLists] = useState<ListSummary[] | null>(null);

	useEffect(() => {
		api.lists().then((d) => setLists(d.lists));
		// Reload lists when navigating to a list view (membership might have changed)
	}, []);

	useEffect(() => {
		if (view.kind === "list") {
			api.lists().then((d) => setLists(d.lists));
		}
	}, [view]);

	const isHome = view.kind === "home";
	const isUnplayed = view.kind === "filter" && view.what === "unplayed";
	const isRecent = view.kind === "filter" && view.what === "recent";

	return (
		<aside className="w-56 shrink-0 h-screen sticky top-0 border-r border-zinc-800 bg-zinc-925 flex flex-col">
			<div className="px-4 py-4 border-b border-zinc-800">
				<button
					type="button"
					onClick={() => onNavigate({ kind: "home" })}
					className="text-lg font-bold tracking-tight hover:text-emerald-400 transition-colors"
				>
					SEG
				</button>
			</div>

			<nav className="flex-1 overflow-y-auto py-3">
				<Section title="Library">
					<NavItem
						active={isHome}
						onClick={() => onNavigate({ kind: "home" })}
						icon="🏠"
						label="Home"
					/>
					<NavItem
						active={isUnplayed}
						onClick={() =>
							onNavigate({ kind: "filter", what: "unplayed" })
						}
						icon="📥"
						label="Unplayed"
					/>
					<NavItem
						active={isRecent}
						onClick={() =>
							onNavigate({ kind: "filter", what: "recent" })
						}
						icon="🕒"
						label="Recently played"
					/>
				</Section>

				<Section title="Lists">
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
					{lists?.length === 0 && (
						<div className="px-4 py-1 text-xs text-zinc-600">No lists yet</div>
					)}
				</Section>

				{recentSearches.length > 0 && (
					<Section
						title="Recent searches"
						action={
							<button
								type="button"
								onClick={onClearRecent}
								className="text-[10px] text-zinc-600 hover:text-zinc-400"
							>
								clear
							</button>
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
		</aside>
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
		<div className="mb-5">
			<div className="px-4 py-1 flex items-center justify-between">
				<h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
					{title}
				</h3>
				{action}
			</div>
			<div className="mt-1 space-y-px">{children}</div>
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
			className={`w-full px-4 py-1.5 flex items-center gap-2.5 text-sm text-left transition-colors ${
				active
					? "bg-zinc-800 text-zinc-100"
					: "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
			}`}
		>
			<span className="w-4 text-center text-base leading-none">{icon}</span>
			<span className="flex-1 truncate">{label}</span>
			{count !== undefined && (
				<span className="text-[10px] text-zinc-500 tabular-nums">{count}</span>
			)}
		</button>
	);
}
