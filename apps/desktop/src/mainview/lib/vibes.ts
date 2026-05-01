/**
 * Static vibe-search chips. Click → fills the search box with `query`.
 * Mirrored on the server in src/routes/curate.ts (`by_vibe`); kept here so
 * the desktop can render them without round-tripping /curate first.
 */

export interface Vibe {
	label: string;
	query: string;
	emoji: string;
}

export const VIBES: Vibe[] = [
	{
		label: 'Cozy & contemplative',
		query: 'cozy puzzle game with story',
		emoji: '🍵',
	},
	{
		label: 'Indie horror',
		query: 'indie first person horror atmospheric',
		emoji: '🕯️',
	},
	{ label: 'Cyberpunk', query: 'cyberpunk dystopian neon hacker', emoji: '🌆' },
	{
		label: 'Roguelike runs',
		query: 'roguelike deck builder run-based',
		emoji: '🎲',
	},
	{
		label: 'Soulslike',
		query: 'soulslike fast combat parry difficult',
		emoji: '⚔️',
	},
	{
		label: 'Walking sim',
		query: 'narrative walking simulator atmospheric story',
		emoji: '🚶',
	},
	{
		label: 'Couch co-op',
		query: 'split-screen couch co-op friends',
		emoji: '🛋️',
	},
	{
		label: 'Retro pixel',
		query: 'retro pixel art 16-bit platformer',
		emoji: '👾',
	},
	{
		label: 'Survival craft',
		query: 'open world survival craft base building',
		emoji: '🪓',
	},
	{
		label: 'Sci-fi exploration',
		query: 'atmospheric sci-fi alien exploration',
		emoji: '🛸',
	},
	{ label: 'Stealth', query: 'stealth assassin shadow infiltrate', emoji: '🗡️' },
	{
		label: 'City builder',
		query: 'city builder management simulation',
		emoji: '🏙️',
	},
	{
		label: 'Detective',
		query: 'detective noir mystery investigation dialog',
		emoji: '🔎',
	},
	{
		label: 'Hand-drawn',
		query: 'beautiful hand-drawn art adventure',
		emoji: '🎨',
	},
	{
		label: 'Speedrun fast',
		query: 'fast movement speedrun arcade',
		emoji: '💨',
	},
	{
		label: 'Existential RPG',
		query: 'existential dread story-driven RPG',
		emoji: '🌒',
	},
];
