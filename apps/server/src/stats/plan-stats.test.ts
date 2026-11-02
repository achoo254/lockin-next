import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, openPglite } from '../db/client';
import { planOptions } from '../db/schema';
import { planBody } from '../../test/plan-browser';
import { CreatePlanInput } from '../plans/plan-input';
import { createPlan, finishPlan, joinPlan, lockPlan, recordLinkOpened, setVotes } from '../plans/plan-store';
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

/** A plan made at `at` with `opens` first opens, `voters` guests who join and vote and `lurkers` who only join. */
async function plan(sub: string, at: Date, shape: { opens: number; voters: number; lurkers: number; sourcePlanId?: string }): Promise<string> {
  const { db } = database;
  const input = CreatePlanInput.parse(planBody(at.getTime(), { creatorDisplayName: 'Owner' }));
  const { plan: row, shareToken } = await createPlan(db, { creatorSub: sub, input, sourcePlanId: shape.sourcePlanId ?? null, now: at });
  for (let i = 0; i < shape.opens; i++) await recordLinkOpened(db, row.id, at);
  const [option] = await db.select().from(planOptions).where(eq(planOptions.planId, row.id));
  for (let i = 0; i < shape.voters + shape.lurkers; i++) {
    const guest = { sub: null, guestToken: newToken() };
    await joinPlan(db, shareToken, guest, `Guest ${i}`, at);
    if (i < shape.voters) await setVotes(db, shareToken, guest, option ? [option.id] : [], at);
  }
  // The creator voting is not a guest vote.
  await setVotes(db, shareToken, { sub, guestToken: null }, option ? [option.id] : [], at);
  return row.id;
}

async function lockAndFinish(sub: string, planId: string, at: Date, outcome: 'done' | 'cancelled' | null): Promise<void> {
  const { db } = database;
  const options = await db.select().from(planOptions).where(eq(planOptions.planId, planId));
  const pick = (kind: string): string | undefined => options.find((o) => o.kind === kind)?.id;
  await lockPlan(db, planId, sub, { timeOptionId: pick('time'), placeOptionId: pick('place') }, at);
  if (outcome) await finishPlan(db, planId, sub, outcome, at);
}

async function seed(): Promise<void> {
  // The owner's own plan, busy, to be filtered out.
  await plan('owner', t0, { opens: 9, voters: 5, lurkers: 0 });
  // c1: a locked-and-done plan, then a second one 10 days later (comes back), cancelled.
  const first = await plan('c1', t0, { opens: 4, voters: 2, lurkers: 1 });
  await lockAndFinish('c1', first, t0, 'done');
  const second = await plan('c1', new Date(t0.getTime() + 10 * DAY), { opens: 1, voters: 0, lurkers: 0 });
  await finishPlan(database.db, second, 'c1', 'cancelled', new Date(t0.getTime() + 10 * DAY));
  // c2: a guest of c1's plan who made one; c3 makes a second plan only 40 days later (does not count as back).
  await plan('c2', t0, { opens: 0, voters: 1, lurkers: 0, sourcePlanId: first });
  await plan('c3', t0, { opens: 0, voters: 0, lurkers: 0 });
  await plan('c3', new Date(t0.getTime() + 40 * DAY), { opens: 0, voters: 0, lurkers: 0 });
}

describe('pnpm stats', () => {
  it('counts the funnel of everyone outside the excluded accounts', async () => {
    const stats = await computeStats(database.db, { excludeSubs: ['owner'] });
    expect(stats).toEqual({
      plans: 5,
      byStatus: { open: 3, locked: 0, done: 1, cancelled: 1, expired: 0 },
      // c1's first plan (2 guests + creator) and c2's (1 guest + creator); creator votes count as voters of a plan.
      plansWithTwoVoters: 2,
      opens: 5,
      joins: 4,
      voters: 3,
      locked: 1,
      done: 1,
      cancelled: 1,
      creators: 3,
      returningCreators: 1,
      guestsTurnedCreators: 1,
    });
  });

  it('includes the owner without exclusions', async () => {
    const stats = await computeStats(database.db);
    expect(stats).toMatchObject({ plans: 6, opens: 14, joins: 9, voters: 8, creators: 4, plansWithTwoVoters: 3 });
  });

  it('prints one figure per line with the rates', async () => {
    const text = formatStats(await computeStats(database.db, { excludeSubs: ['owner'] }), 'without 1 excluded account(s)');
    expect(text).toContain('Plans (without 1 excluded account(s))');
    expect(text).toMatch(/link opens:\s+5/);
    expect(text).toMatch(/guests joined:\s+4 \(80\.0% of opens\)/);
    expect(text).toMatch(/guests voted:\s+3 \(75\.0% of joins\)/);
    expect(text).toMatch(/guests turned creators:\s+1/);
  });

  it('reads the excluded accounts from a comma- or space-separated list', () => {
    expect(parseSubs(' a, b  c,,')).toEqual(['a', 'b', 'c']);
    expect(parseSubs(undefined)).toEqual([]);
  });
});
