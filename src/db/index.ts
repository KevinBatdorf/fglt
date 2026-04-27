import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const DATABASE_URL =
	process.env.DATABASE_URL || 'postgres://steam:steam@localhost:5532/steam';

export const sql = postgres(DATABASE_URL, { max: 20 });
export const raw = sql;
export const db = drizzle(sql, { schema });
