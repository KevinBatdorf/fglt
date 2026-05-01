/**
 * localStorage-backed user preferences. Single-user desktop app, so no
 * server roundtrip. Each pref has a getter + setter and a default.
 */

const KEY = {
	recentlyAddedMonths: 'seg.prefs.recentlyAddedMonths.v1',
	vibesEnabled: 'seg.prefs.vibesEnabled.v1',
	vibesCount: 'seg.prefs.vibesCount.v1',
	sidebar: 'seg.prefs.sidebar.v1',
	cardsPerRow: 'seg.prefs.cardsPerRow.v1',
	alwaysShowRefreshIcons: 'seg.prefs.alwaysShowRefreshIcons.v1',
} as const;

export const RECENTLY_ADDED_MONTHS_DEFAULT = 2;
export const VIBES_ENABLED_DEFAULT = true;
export const VIBES_COUNT_DEFAULT = 12;
export const VIBES_COUNT_MIN = 0;
export const VIBES_COUNT_MAX = 60;
export const CARDS_PER_ROW_DEFAULT = 7;
export const CARDS_PER_ROW_MIN = 3;
export const CARDS_PER_ROW_MAX = 14;

export type SidebarKey =
	| 'trending'
	| 'recommended'
	| 'random'
	| 'unplayed'
	| 'recently_played'
	| 'recently_added'
	| 'platforms'
	| 'lists'
	| 'recent_searches';

export type SidebarVisibility = Record<SidebarKey, boolean>;

export const SIDEBAR_DEFAULT: SidebarVisibility = {
	trending: true,
	recommended: true,
	random: true,
	unplayed: true,
	recently_played: true,
	recently_added: true,
	platforms: true,
	lists: true,
	recent_searches: true,
};

export const SIDEBAR_LABELS: Record<SidebarKey, string> = {
	trending: 'Trending',
	recommended: 'Recommended',
	random: 'Random',
	unplayed: 'Unplayed',
	recently_played: 'Recently played',
	recently_added: 'Recently added',
	platforms: 'Platforms section',
	lists: 'Lists section',
	recent_searches: 'Recent searches section',
};

export function getRecentlyAddedMonths(): number {
	try {
		const raw = localStorage.getItem(KEY.recentlyAddedMonths);
		if (!raw) return RECENTLY_ADDED_MONTHS_DEFAULT;
		const n = Number.parseInt(raw, 10);
		if (!Number.isFinite(n)) return RECENTLY_ADDED_MONTHS_DEFAULT;
		return Math.min(Math.max(n, 1), 60);
	} catch {
		return RECENTLY_ADDED_MONTHS_DEFAULT;
	}
}

export function setRecentlyAddedMonths(months: number): void {
	try {
		localStorage.setItem(KEY.recentlyAddedMonths, String(months));
	} catch {
		/* ignore quota errors etc. */
	}
}

export function getVibesEnabled(): boolean {
	try {
		const raw = localStorage.getItem(KEY.vibesEnabled);
		if (raw === null) return VIBES_ENABLED_DEFAULT;
		return raw === 'true';
	} catch {
		return VIBES_ENABLED_DEFAULT;
	}
}

export function setVibesEnabled(enabled: boolean): void {
	try {
		localStorage.setItem(KEY.vibesEnabled, enabled ? 'true' : 'false');
		window.dispatchEvent(new CustomEvent('seg:prefs:vibes-toggled'));
	} catch {
		/* ignore */
	}
}

export function getVibesCount(): number {
	try {
		const raw = localStorage.getItem(KEY.vibesCount);
		if (!raw) return VIBES_COUNT_DEFAULT;
		const n = Number.parseInt(raw, 10);
		if (!Number.isFinite(n)) return VIBES_COUNT_DEFAULT;
		return Math.min(Math.max(n, VIBES_COUNT_MIN), VIBES_COUNT_MAX);
	} catch {
		return VIBES_COUNT_DEFAULT;
	}
}

export function setVibesCount(n: number): void {
	try {
		localStorage.setItem(KEY.vibesCount, String(n));
		window.dispatchEvent(new CustomEvent('seg:prefs:vibes-toggled'));
	} catch {
		/* ignore */
	}
}

export function getSidebarVisibility(): SidebarVisibility {
	try {
		const raw = localStorage.getItem(KEY.sidebar);
		if (!raw) return { ...SIDEBAR_DEFAULT };
		const parsed = JSON.parse(raw) as Partial<SidebarVisibility>;
		return { ...SIDEBAR_DEFAULT, ...parsed };
	} catch {
		return { ...SIDEBAR_DEFAULT };
	}
}

export function setSidebarVisibility(v: SidebarVisibility): void {
	try {
		localStorage.setItem(KEY.sidebar, JSON.stringify(v));
		window.dispatchEvent(new CustomEvent('seg:prefs:sidebar-toggled'));
	} catch {
		/* ignore */
	}
}

export function getCardsPerRow(): number {
	try {
		const raw = localStorage.getItem(KEY.cardsPerRow);
		if (!raw) return CARDS_PER_ROW_DEFAULT;
		const n = Number.parseInt(raw, 10);
		if (!Number.isFinite(n)) return CARDS_PER_ROW_DEFAULT;
		return Math.min(Math.max(n, CARDS_PER_ROW_MIN), CARDS_PER_ROW_MAX);
	} catch {
		return CARDS_PER_ROW_DEFAULT;
	}
}

export function setCardsPerRow(n: number): void {
	try {
		localStorage.setItem(KEY.cardsPerRow, String(n));
		window.dispatchEvent(new CustomEvent('seg:prefs:cards-per-row'));
	} catch {
		/* ignore */
	}
}

export function getAlwaysShowRefreshIcons(): boolean {
	try {
		return localStorage.getItem(KEY.alwaysShowRefreshIcons) === 'true';
	} catch {
		return false;
	}
}

export function setAlwaysShowRefreshIcons(v: boolean): void {
	try {
		localStorage.setItem(KEY.alwaysShowRefreshIcons, v ? 'true' : 'false');
		window.dispatchEvent(new CustomEvent('seg:prefs:always-refresh-icons'));
	} catch {
		/* ignore */
	}
}
