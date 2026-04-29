import { type SQL, sql } from 'drizzle-orm';
import {
	boolean,
	customType,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	vector,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({
	dataType() {
		return 'tsvector';
	},
});

export const games = pgTable(
	'games',
	{
		appid: integer('appid').primaryKey(),
		name: text('name').notNull(),
		type: text('type'),
		playtime_min: integer('playtime_min').notNull().default(0),
		playtime_2wk: integer('playtime_2wk').notNull().default(0),
		last_played: timestamp('last_played', { withTimezone: true }),

		short_desc: text('short_desc'),
		about: text('about'),
		detailed_desc: text('detailed_desc'),
		release_date: text('release_date'),
		is_free: boolean('is_free'),
		required_age: integer('required_age'),
		developers: text('developers').array(),
		publishers: text('publishers').array(),
		genres: text('genres').array(),
		categories: text('categories').array(),
		platforms: jsonb('platforms'),
		controller: text('controller'),
		metacritic: integer('metacritic'),
		metacritic_url: text('metacritic_url'),
		header_image: text('header_image'),
		capsule_image: text('capsule_image'),
		website: text('website'),
		price_cents: integer('price_cents'),
		currency: text('currency'),

		owners_estimate: text('owners_estimate'),
		positive: integer('positive'),
		negative: integer('negative'),
		avg_playtime: integer('avg_playtime'),
		median_playtime: integer('median_playtime'),
		ccu: integer('ccu'),

		hltb_main: real('hltb_main'),
		hltb_extra: real('hltb_extra'),
		hltb_complete: real('hltb_complete'),

		embedding: vector('embedding', { dimensions: 768 }),

		created_at: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
		updated_at: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
		enriched_at: timestamp('enriched_at', { withTimezone: true }),
		embedded_at: timestamp('embedded_at', { withTimezone: true }),
		youtube_fetched_at: timestamp('youtube_fetched_at', { withTimezone: true }),

		search: tsvector('search').generatedAlwaysAs(
			(): SQL =>
				sql`setweight(to_tsvector('english', coalesce(${games.name}, '')), 'A') ||
			setweight(to_tsvector('english', coalesce(${games.short_desc}, '')), 'B') ||
			setweight(to_tsvector('english', coalesce(${games.about}, '')), 'C')`,
		),
	},
	(t) => [
		index('idx_games_search').using('gin', t.search),
		index('idx_games_enriched_at').on(t.enriched_at),
		index('idx_games_embedded_at').on(t.embedded_at),
		index('idx_games_youtube_fetched_at').on(t.youtube_fetched_at),
	],
);

export const game_tags = pgTable(
	'game_tags',
	{
		appid: integer('appid').notNull(),
		tag: text('tag').notNull(),
		votes: integer('votes').notNull().default(0),
	},
	(t) => [
		primaryKey({ columns: [t.appid, t.tag] }),
		index('idx_game_tags_tag').on(t.tag),
	],
);

export const game_similar = pgTable(
	'game_similar',
	{
		appid: integer('appid').notNull(),
		similar_appid: integer('similar_appid').notNull(),
		rank: integer('rank').notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.appid, t.similar_appid] }),
		index('idx_game_similar_target').on(t.similar_appid),
	],
);

export const game_videos = pgTable(
	'game_videos',
	{
		appid: integer('appid').notNull(),
		video_id: text('video_id').notNull(),
		title: text('title').notNull(),
		channel: text('channel'),
		channel_id: text('channel_id'),
		description: text('description'),
		thumbnail_url: text('thumbnail_url'),
		published_at: timestamp('published_at', { withTimezone: true }),
		rank: integer('rank').notNull().default(0),
		query_used: text('query_used'),
		fetched_at: timestamp('fetched_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.appid, t.video_id] }),
		index('idx_game_videos_fetched').on(t.fetched_at),
	],
);

export const meta = pgTable('meta', {
	key: text('key').primaryKey(),
	value: text('value'),
	updated: timestamp('updated', { withTimezone: true }).notNull().defaultNow(),
});

export const platform_ownership = pgTable(
	'platform_ownership',
	{
		appid: integer('appid').notNull(),
		platform: text('platform').notNull(),
		external_id: text('external_id').notNull(),
		title_at_source: text('title_at_source'),
		acquired_at: timestamp('acquired_at', { withTimezone: true }),
		playtime_min: integer('playtime_min').notNull().default(0),
		last_played: timestamp('last_played', { withTimezone: true }),
		created_at: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
		updated_at: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.appid, t.platform] }),
		index('idx_platform_ownership_platform').on(t.platform),
	],
);

export const unmatched_ownership = pgTable(
	'unmatched_ownership',
	{
		platform: text('platform').notNull(),
		external_id: text('external_id').notNull(),
		title_at_source: text('title_at_source').notNull(),
		developer: text('developer'),
		first_seen: timestamp('first_seen', { withTimezone: true })
			.notNull()
			.defaultNow(),
		last_seen: timestamp('last_seen', { withTimezone: true })
			.notNull()
			.defaultNow(),
		resolved_appid: integer('resolved_appid'),
	},
	(t) => [primaryKey({ columns: [t.platform, t.external_id] })],
);
