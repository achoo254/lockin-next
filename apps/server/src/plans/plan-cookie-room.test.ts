import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, openPglite } from '../db/client';
import { planBody } from '../../test/plan-browser';
import { cookiesToDrop } from './plan-cookie-room';
import { CreatePlanInput } from './plan-input';
import { createPlan } from './plan-store';
import { PLAN_COOKIE_ROOM } from './retention';
import { shareTokenBox } from './share-token-box';
import { type PlanCookie, newToken } from './tokens';

let database: DbHandle;
const box = shareTokenBox(randomBytes(32));
const now = new Date();

beforeAll(async () => {
  database = await openPglite();
});
afterAll(async () => {
  await database.close();
});

/** A cookie of a plan that exists, with its vote deadline `deadlineInHours` from now (negative: past). */
async function livePlanCookie(deadlineInHours = 24): Promise<PlanCookie> {
  // Made a moment before its deadline, as a plan always is.
  const madeAt = new Date(now.getTime() + (deadlineInHours - 24) * 60 * 60 * 1000);
  const input = CreatePlanInput.parse(planBody(madeAt.getTime(), { creatorDisplayName: 'Minh' }));
  const { plan } = await createPlan(database.db, { creatorSub: null, input, sourcePlanId: null, box, now: madeAt });
  return { planId: plan.id, token: newToken() };
}

const goneCookie = (): PlanCookie => ({ planId: randomUUID(), token: newToken() });

describe('room for per-plan cookies', () => {
  it('drops nothing while there is room, or when the plan’s cookie is only replaced', async () => {
    const held = await Promise.all(Array.from({ length: PLAN_COOKIE_ROOM - 1 }, () => livePlanCookie()));
    expect(await cookiesToDrop(database.db, held, randomUUID(), now)).toEqual([]);
    const full = [...held, await livePlanCookie()];
    expect(await cookiesToDrop(database.db, full, full[3]?.planId ?? '', now)).toEqual([]);
  });

  it('drops cookies of plans gone or read-only first, then the oldest, to keep the room with the new one', async () => {
    const live = await Promise.all(Array.from({ length: PLAN_COOKIE_ROOM - 2 }, () => livePlanCookie()));
    const gone = goneCookie();
    const readOnly = await livePlanCookie(-24 * 30);
    // Oldest first, as a browser sends them: the stale ones sit among the live ones.
    const held = [...live.slice(0, 5), gone, ...live.slice(5, 20), readOnly, ...live.slice(20)];
    expect(held).toHaveLength(PLAN_COOKIE_ROOM);
    expect(await cookiesToDrop(database.db, held, randomUUID(), now)).toEqual([gone]);

    // Two cookies more, so three go for the new one to fit: both stale ones, then the oldest live one.
    const more = [...held, await livePlanCookie(), await livePlanCookie()];
    expect(await cookiesToDrop(database.db, more, randomUUID(), now)).toEqual([gone, readOnly, live[0]]);
  });
});
