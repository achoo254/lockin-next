import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = path.join(SERVER_DIR, 'drizzle');
export const DEV_PGLITE_DIR = path.resolve(SERVER_DIR, '../../.data/pglite');

/** Real Postgres (production). Migrations run on open so the schema always matches the code. */
export async function openPostgres(connectionString: string): Promise<DbHandle> {
  // A small pool: the app is light and shares the host's Postgres with other products.
  const pool = new pg.Pool({ connectionString, max: 4 });
  // An idle client losing its connection (the shared Postgres restarting) emits `error` on the pool; without
  // a listener Node would crash the process. The pool drops that client and opens a new one when needed.
  pool.on('error', (error) => console.error('postgres idle client error', error.message));
  const db = drizzleNodePg(pool, { schema });
  await migrateNodePg(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => pool.end() };
}

/** Embedded Postgres for dev (directory under `.data/`, gitignored) and tests (in memory when `dir` is omitted). */
export async function openPglite(dir?: string): Promise<DbHandle> {
  // Loaded on demand: the production bundle runs on Postgres and ships without PGlite.
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
  ]);
  if (dir) await mkdir(dir, { recursive: true });
  const client = dir ? new PGlite(dir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.close() };
}
