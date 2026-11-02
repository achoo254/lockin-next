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
import { type Db, type DbHandle, openPglite } from './client';
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

/**
 * Rollback safety: a failed release falls back to the previous one (cc545f1) on the schema this migration left. That
 * release knows no `is_creator` and no creator token; these are its inserts, column for column (its plan-store.ts
 * createPlan and joinPlan, as drizzle sends them), run on the migrated schema. They must succeed, and this release
 * must still read the plans they make.
 */
describe('the previous release on the migrated schema', () => {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await openPglite();
  });
  afterAll(async () => {
    await handle.close();
  });

  it('makes plans, joins as creator and guest, and this release still reads them right', async () => {
    const { db: current } = handle;
    const at = new Date();
    const day = 24 * 60 * 60 * 1000;
    const shareToken = newToken();
    const guestToken = newToken();
    const planId = '22222222-2222-4222-8222-222222222222';
    const bareId = '33333333-3333-4333-8333-333333333333';
    const iso = (offset: number): string => new Date(at.getTime() + offset).toISOString();
    // createPlan: the plan (creator_sub always set), its options, the creator's row with only creator_sub.
    for (const [id, token] of [
      [planId, shareToken],
      [bareId, newToken()],
    ] as const) {
      await current.execute(sql`
        insert into plans (id, creator_sub, title, activity, area, budget_per_person, group_size, vote_deadline, status, share_token_hash, share_token_enc, locked_option_ids, locked_at, created_at, updated_at)
        values (${id}, 'old-release-account', 'Kèo bản cũ', 'coffee', null, null, null, ${iso(day)}, default, ${hashToken(token)}, null, null, null, ${iso(0)}, ${iso(0)})`);
      await current.execute(sql`
        insert into plan_options (id, plan_id, kind, label, map_url, starts_at, sort_order)
        values (default, ${id}, 'time', '', null, ${iso(2 * day)}, 0), (default, ${id}, 'place', 'Quán A', null, null, 0)`);
    }
    await current.execute(sql`
      insert into participants (id, plan_id, display_name, guest_token_hash, creator_sub, rsvp, joined_at)
      values (default, ${planId}, 'Chủ kèo', null, 'old-release-account', 'going', ${iso(0)}) returning id`);
    // joinPlan, the creator again (on conflict: rename) and a guest; then the creator of the plan made without a name.
    const join = (id: string, name: string, identity: { creatorSub: string | null; guestTokenHash: string | null }): Promise<unknown> =>
      current.execute(sql`
        insert into participants (id, plan_id, display_name, guest_token_hash, creator_sub, rsvp, joined_at)
        values (default, ${id}, ${name}, ${identity.guestTokenHash}, ${identity.creatorSub}, null, ${iso(0)})
        on conflict do nothing returning id`);
    await join(planId, 'Chủ kèo', { creatorSub: 'old-release-account', guestTokenHash: null });
    await join(planId, 'Khách', { creatorSub: null, guestTokenHash: hashToken(guestToken) });
    await join(bareId, 'Chủ kèo sau', { creatorSub: 'old-release-account', guestTokenHash: null });

    const people = await current.select().from(schema.participants).where(eq(schema.participants.planId, planId));
    expect(people.map((p) => [p.displayName, p.isCreator, p.creatorSub]).sort()).toEqual([
      ['Chủ kèo', true, 'old-release-account'],
      ['Khách', false, null],
    ]);
    const [bareCreator] = await current.select().from(schema.participants).where(eq(schema.participants.planId, bareId));
    expect(bareCreator).toMatchObject({ displayName: 'Chủ kèo sau', isCreator: true });

    // This release: the account manages the plan and is its creator row; the guest is the guest.
    const [plan] = await current.select().from(schema.plans).where(eq(schema.plans.id, planId));
    if (!plan) throw new Error('plan missing');
    const owner = { sub: 'old-release-account', guestToken: null };
    const ownerRow = await findParticipantId(current, plan, owner);
    expect(ownerRow).toBe(people.find((p) => p.isCreator)?.id);
    const view = await buildPlanView(current, plan, { isCreator: true, participantId: ownerRow }, at);
    expect(view).toMatchObject({ creatorName: 'Chủ kèo', savedToAccount: true, manage: null });
    expect(view.participants.map((p) => [p.displayName, p.isCreator])).toEqual([
      ['Chủ kèo', true],
      ['Khách', false],
    ]);
    expect(await findParticipantId(current, plan, { sub: null, guestToken })).toBe(people.find((p) => !p.isCreator)?.id);
    await joinPlan(current, shareToken, owner, 'Chủ kèo đổi tên', at);
    const options = await current.select().from(schema.planOptions).where(eq(schema.planOptions.planId, planId));
    const pick = (kind: string): string | undefined => options.find((o) => o.kind === kind)?.id;
    await lockPlan(current, planId, { sub: 'old-release-account' }, { timeOptionId: pick('time'), placeOptionId: pick('place') }, at);
    const [locked] = await current.select().from(schema.plans).where(eq(schema.plans.id, planId));
    expect(locked?.status).toBe('locked');
  });
});
