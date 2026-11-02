import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, openPglite } from '../db/client';
import { planEvents, planOptions } from '../db/schema';
import { planBody } from '../../test/plan-browser';
import { CreatePlanInput } from '../plans/plan-input';
import { claimPlan, createPlan, finishPlan, joinPlan, lockPlan, recordLinkOpened, setVotes } from '../plans/plan-store';
import { shareTokenBox } from '../plans/share-token-box';
import { newToken } from '../plans/tokens';
import { computeStats, formatStats, parseSubs } from './plan-stats';

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date('2026-11-02T03:00:00Z');

let database: DbHandle;
beforeAll(async () => {
  database = await openPglite();
  await seed();
});
afterAll(async () => {
  await database.close();
});

/** Creator tokens of the plans made signed out, by plan id. */
const creatorTokens = new Map<string, string>();

/**
 * A plan made at `at` (by an account, or signed out for `null`) with `opens` first opens, `voters` guests who join
 * and vote and `lurkers` who only join.
 */
async function plan(sub: string | null, at: Date, shape: { opens: number; voters: number; lurkers: number; sourcePlanId?: string }): Promise<string> {
  const { db } = database;
  const input = CreatePlanInput.parse(planBody(at.getTime(), { creatorDisplayName: 'Owner' }));
  const created = await createPlan(db, { creatorSub: sub, input, sourcePlanId: shape.sourcePlanId ?? null, box: shareTokenBox(randomBytes(32)), now: at });
  const { plan: row, shareToken, creatorToken } = created;
  creatorTokens.set(row.id, creatorToken);
  for (let i = 0; i < shape.opens; i++) await recordLinkOpened(db, row.id, at);
  const [option] = await db.select().from(planOptions).where(eq(planOptions.planId, row.id));
  for (let i = 0; i < shape.voters + shape.lurkers; i++) {
    const guest = { sub: null, guestToken: newToken() };
    await joinPlan(db, shareToken, guest, `Guest ${i}`, at);
    if (i < shape.voters) await setVotes(db, shareToken, guest, option ? [option.id] : [], at);
  }
  // The creator voting is not a guest vote.
  await setVotes(db, shareToken, { sub, creatorToken, guestToken: null }, option ? [option.id] : [], at);
  return row.id;
}

async function lockAndFinish(sub: string, planId: string, at: Date, outcome: 'done' | 'cancelled' | null): Promise<void> {
  const { db } = database;
  const options = await db.select().from(planOptions).where(eq(planOptions.planId, planId));
  const pick = (kind: string): string | undefined => options.find((o) => o.kind === kind)?.id;
  await lockPlan(db, planId, { sub }, { timeOptionId: pick('time'), placeOptionId: pick('place') }, at);
  if (outcome) await finishPlan(db, planId, { sub }, outcome, at);
}

async function seed(): Promise<void> {
  // The owner's own plan, busy, to be filtered out.
  await plan('owner', t0, { opens: 9, voters: 5, lurkers: 0 });
  // c1: a locked-and-done plan, then a second one 10 days later (comes back), cancelled.
  const first = await plan('c1', t0, { opens: 4, voters: 2, lurkers: 1 });
  await lockAndFinish('c1', first, t0, 'done');
  const second = await plan('c1', new Date(t0.getTime() + 10 * DAY), { opens: 1, voters: 0, lurkers: 0 });
  await finishPlan(database.db, second, { sub: 'c1' }, 'cancelled', new Date(t0.getTime() + 10 * DAY));
  // c2: a guest of c1's plan who made one; c3 makes a second plan only 40 days later (does not count as back).
  await plan('c2', t0, { opens: 0, voters: 1, lurkers: 0, sourcePlanId: first });
  const older = await plan('c3', t0, { opens: 0, voters: 0, lurkers: 0 });
  await plan('c3', new Date(t0.getTime() + 40 * DAY), { opens: 0, voters: 0, lurkers: 0 });
  // A plan logged before plan_created carried how it was made: made signed in (it was the only way then).
  await database.db
    .update(planEvents)
    .set({ payload: null })
    .where(and(eq(planEvents.planId, older), eq(planEvents.type, 'plan_created')));
  // Two plans made signed out: one by a guest of c1's plan, kept in the browser; one saved to c4 later.
  await plan(null, t0, { opens: 2, voters: 1, lurkers: 0, sourcePlanId: first });
  const saved = await plan(null, t0, { opens: 0, voters: 0, lurkers: 0 });
  await claimPlan(database.db, saved, 'c4', creatorTokens.get(saved) ?? null, t0);
}

describe('pnpm stats', () => {
  it('counts the funnel of everyone outside the excluded accounts', async () => {
    const stats = await computeStats(database.db, { excludeSubs: ['owner'] });
    expect(stats).toEqual({
      plans: 7,
      byStatus: { open: 5, locked: 0, done: 1, cancelled: 1, expired: 0 },
      // c1's first plan (2 guests + creator), c2's and the signed-out guest's (1 guest + creator each); creator votes
      // count as voters of a plan.
      plansWithTwoVoters: 3,
      opens: 7,
      joins: 5,
      voters: 4,
      locked: 1,
      done: 1,
      cancelled: 1,
      // c1, c2, c3, and c4 by the plan saved to it.
      creators: 4,
      returningCreators: 1,
      // c2, and the plan made signed out by a guest of c1's plan.
      guestsTurnedCreators: 2,
      madeSignedIn: 5,
      madeSignedOut: 2,
      claimed: 1,
    });
  });

  it('includes the owner without exclusions', async () => {
    const stats = await computeStats(database.db);
    expect(stats).toMatchObject({ plans: 8, opens: 16, joins: 10, voters: 9, creators: 5, plansWithTwoVoters: 4, madeSignedIn: 6, madeSignedOut: 2 });
  });

  it('prints one figure per line with the rates', async () => {
    const text = formatStats(await computeStats(database.db, { excludeSubs: ['owner'] }), 'without 1 excluded account(s)');
    expect(text).toContain('Plans (without 1 excluded account(s))');
    expect(text).toMatch(/link opens:\s+7/);
    expect(text).toMatch(/guests joined:\s+5 \(71\.4% of opens\)/);
    expect(text).toMatch(/guests voted:\s+4 \(80\.0% of joins\)/);
    expect(text).toMatch(/guests turned creators:\s+2/);
    expect(text).toMatch(/made signed out:\s+2 \(28\.6% of plans\)/);
    expect(text).toMatch(/saved to an account:\s+1 \(50\.0% of made signed out\)/);
    expect(text).not.toMatch(/Owner/);
  });

  it('reads the excluded accounts from a comma- or space-separated list', () => {
    expect(parseSubs(' a, b  c,,')).toEqual(['a', 'b', 'c']);
    expect(parseSubs(undefined)).toEqual([]);
  });
});
