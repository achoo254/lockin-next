import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, openPglite } from '../db/client';
import { participants, planEvents, planOptions, plans, votes } from '../db/schema';
import { HttpError } from '../http-error';
import { planBody } from '../../test/plan-browser';
import { CreatePlanInput } from './plan-input';
import { createPlan, findPlanByShareToken, finishPlan, joinPlan, lockPlan, setVotes, sweepPlans } from './plan-store';
import { newToken } from './tokens';

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date('2026-11-02T03:00:00Z');
/** planBody puts the vote deadline a day after `now`. */
const deadline = new Date(t0.getTime() + DAY);
const after = (days: number, ms = 0): Date => new Date(deadline.getTime() + days * DAY + ms);

let database: DbHandle;
beforeAll(async () => {
  database = await openPglite();
});
afterAll(async () => {
  await database.close();
});

async function seededPlan(sub: string): Promise<{ id: string; token: string }> {
  const { db } = database;
  const { plan, shareToken } = await createPlan(db, { creatorSub: sub, input: CreatePlanInput.parse(planBody(t0.getTime())), sourcePlanId: null, now: t0 });
  const guest = { sub: null, guestToken: newToken() };
  await joinPlan(db, shareToken, guest, 'Linh', t0);
  const options = await db.select().from(planOptions).where(eq(planOptions.planId, plan.id));
  await setVotes(
    db,
    shareToken,
    guest,
    options.map((o) => o.id),
    t0,
  );
  return { id: plan.id, token: shareToken };
}

async function rowsOf(planId: string): Promise<number[]> {
  const { db } = database;
  return Promise.all([
    db.select().from(plans).where(eq(plans.id, planId)),
    db.select().from(planOptions).where(eq(planOptions.planId, planId)),
    db.select().from(participants).where(eq(participants.planId, planId)),
    db.select().from(votes).where(eq(votes.planId, planId)),
    db.select().from(planEvents).where(eq(planEvents.planId, planId)),
  ]).then((tables) => tables.map((rows) => rows.length));
}

async function refusal(action: Promise<unknown>): Promise<string> {
  try {
    await action;
    return 'allowed';
  } catch (error) {
    if (error instanceof HttpError) return error.code;
    throw error;
  }
}

describe('plan retention', () => {
  it('sweeps open plans read-only 30 days after the deadline and deletes everything of them at 90', async () => {
    const { db } = database;
    const { id, token } = await seededPlan('sweep-a');
    expect(await sweepPlans(db, after(30, -1))).toEqual({ expired: 0, deleted: 0 });
    expect(await sweepPlans(db, after(30))).toEqual({ expired: 1, deleted: 0 });
    const [row] = await db.select().from(plans).where(eq(plans.id, id));
    expect(row?.status).toBe('expired');
    // Read-only: still readable, no change accepted.
    expect((await findPlanByShareToken(db, token, after(31)))?.status).toBe('expired');
    expect(await refusal(setVotes(db, token, { sub: null, guestToken: newToken() }, [], after(31)))).toBe('plan-expired');
    expect(await refusal(lockPlan(db, id, 'sweep-a', {}, after(31)))).toBe('plan-expired');
    expect(await refusal(finishPlan(db, id, 'sweep-a', 'cancelled', after(31)))).toBe('plan-expired');
    expect(await sweepPlans(db, after(31))).toEqual({ expired: 0, deleted: 0 });

    expect(await rowsOf(id)).toEqual([1, 4, 1, 4, 4]);
    expect(await sweepPlans(db, after(90))).toEqual({ expired: 0, deleted: 1 });
    expect(await rowsOf(id)).toEqual([0, 0, 0, 0, 0]);
    expect(await findPlanByShareToken(db, token, after(90))).toBeNull();
  });

  it('keeps done and cancelled plans as they are until deletion', async () => {
    const { db } = database;
    const { id } = await seededPlan('sweep-b');
    await finishPlan(db, id, 'sweep-b', 'cancelled', t0);
    expect(await sweepPlans(db, after(45))).toEqual({ expired: 0, deleted: 0 });
    const [row] = await db.select().from(plans).where(eq(plans.id, id));
    expect(row?.status).toBe('cancelled');
    expect(await sweepPlans(db, after(90))).toEqual({ expired: 0, deleted: 1 });
  });

  it('applies retention lazily when a plan is read before the sweep reaches it', async () => {
    const { db } = database;
    const { id, token } = await seededPlan('lazy-a');
    expect((await findPlanByShareToken(db, token, after(29)))?.status).toBe('open');
    expect((await findPlanByShareToken(db, token, after(30)))?.status).toBe('expired');
    expect((await findPlanByShareToken(db, token, after(31)))?.status).toBe('expired');
    const expiredEvents = (await db.select().from(planEvents).where(eq(planEvents.planId, id))).filter((e) => e.type === 'expired');
    expect(expiredEvents).toHaveLength(1);
    expect(expiredEvents[0]?.actor).toBe('system');
    expect(await findPlanByShareToken(db, token, after(90))).toBeNull();
    expect(await rowsOf(id)).toEqual([0, 0, 0, 0, 0]);
  });
});
