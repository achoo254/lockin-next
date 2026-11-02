/**
 * The migration that lets people make plans signed out runs on a database that already has plans: a plan made by an
 * account before it keeps working (its creator row is marked as the creator, the account still manages it).
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { type PgliteDatabase, drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findParticipantId, finishPlan, joinPlan, lockPlan } from '../plans/plan-store';
import { buildPlanView } from '../plans/plan-view';
import { hashToken, newToken } from '../plans/tokens';
import type { Db } from './client';
import * as schema from './schema';

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
/** The migrations production ran before this one. */
const BEFORE = 3;

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

let client: PGlite;
/** The same database, typed for the PGlite migrator and as the app's Db. */
let pglite: PgliteDatabase<typeof schema>;
let db: Db;
let olderMigrations: string;

beforeAll(async () => {
  // The migrations folder as it was: the first BEFORE migrations and their journal.
  olderMigrations = await mkdtemp(path.join(tmpdir(), 'lockin-migrations-'));
  await cp(MIGRATIONS, olderMigrations, { recursive: true });
  const journal = JSON.parse(await readFile(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as Journal;
  await writeFile(path.join(olderMigrations, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, BEFORE) }));
  client = new PGlite();
  pglite = drizzle(client, { schema });
  db = pglite;
  await migrate(pglite, { migrationsFolder: olderMigrations });
});
afterAll(async () => {
  await client.close();
  await rm(olderMigrations, { recursive: true, force: true });
});

describe('the migration for plans made signed out', () => {
  it('keeps a plan made by an account before it working', async () => {
    const at = new Date();
    const shareToken = newToken();
    const guestToken = newToken();
    const day = 24 * 60 * 60 * 1000;
    // Rows as the old schema had them: creator_sub not null, the creator's row marked by its account.
    const planId = '11111111-1111-4111-8111-111111111111';
    await db.execute(sql`
      insert into plans (id, creator_sub, title, activity, vote_deadline, status, share_token_hash, created_at, updated_at)
      values (${planId}, 'legacy-account', 'Kèo cũ', 'coffee', ${new Date(at.getTime() + day).toISOString()}, 'open', ${hashToken(shareToken)}, ${at.toISOString()}, ${at.toISOString()})`);
    await db.execute(sql`
      insert into plan_options (plan_id, kind, label, starts_at, sort_order)
      values (${planId}, 'time', '', ${new Date(at.getTime() + 2 * day).toISOString()}, 0), (${planId}, 'place', 'Quán A', null, 0)`);
    await db.execute(sql`
      insert into participants (plan_id, display_name, creator_sub, rsvp, joined_at) values (${planId}, 'Chủ kèo', 'legacy-account', 'going', ${at.toISOString()})`);
    await db.execute(sql`
      insert into participants (plan_id, display_name, guest_token_hash, joined_at) values (${planId}, 'Khách', ${hashToken(guestToken)}, ${at.toISOString()})`);

    await migrate(pglite, { migrationsFolder: MIGRATIONS });

    const [plan] = await db.select().from(schema.plans).where(eq(schema.plans.id, planId));
    if (!plan) throw new Error('plan lost in the migration');
    expect(plan).toMatchObject({ creatorSub: 'legacy-account', creatorTokenHash: null, manageTokenEnc: null });
    const people = await db.select().from(schema.participants).where(eq(schema.participants.planId, planId));
    expect(people.map((p) => [p.displayName, p.isCreator, p.creatorSub]).sort()).toEqual([
      ['Chủ kèo', true, 'legacy-account'],
      ['Khách', false, null],
    ]);

    // The account is still the creator, on its own row; the guest is still the guest.
    const creator = { sub: 'legacy-account', guestToken: null };
    const creatorParticipant = await findParticipantId(db, plan, creator);
    const view = await buildPlanView(db, plan, { isCreator: true, participantId: creatorParticipant }, at);
    expect(view).toMatchObject({ creatorName: 'Chủ kèo', savedToAccount: true, manage: null });
    expect(await findParticipantId(db, plan, { sub: null, guestToken })).not.toBeNull();
    await joinPlan(db, shareToken, creator, 'Chủ kèo mới', at);
    expect((await db.select().from(schema.participants).where(eq(schema.participants.planId, planId))).length).toBe(2);
    const options = await db.select().from(schema.planOptions).where(eq(schema.planOptions.planId, planId));
    const pick = (kind: string): string | undefined => options.find((o) => o.kind === kind)?.id;
    await lockPlan(db, planId, { sub: 'legacy-account' }, { timeOptionId: pick('time'), placeOptionId: pick('place') }, at);
    await finishPlan(db, planId, { sub: 'legacy-account' }, 'done', at);
    // Without the account, the old plan has no other key.
    await expect(finishPlan(db, planId, { sub: null, creatorToken: newToken() }, 'cancelled', at)).rejects.toMatchObject({ status: 401 });
  });
});
