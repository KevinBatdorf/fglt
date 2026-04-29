/**
 * localStorage-backed user preferences. Single-user desktop app, so no
 * server roundtrip. Each pref has a getter + setter and a default.
 */

const KEY = {
	recentlyAddedMonths: "seg.prefs.recentlyAddedMonths.v1",
	vibesEnabled: "seg.prefs.vibesEnabled.v1",
} as const;

export const RECENTLY_ADDED_MONTHS_DEFAULT = 2;
export const VIBES_ENABLED_DEFAULT = true;

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
		return raw === "true";
	} catch {
		return VIBES_ENABLED_DEFAULT;
	}
}

export function setVibesEnabled(enabled: boolean): void {
	try {
		localStorage.setItem(KEY.vibesEnabled, enabled ? "true" : "false");
		window.dispatchEvent(new CustomEvent("seg:prefs:vibes-toggled"));
	} catch {
		/* ignore */
	}
}
