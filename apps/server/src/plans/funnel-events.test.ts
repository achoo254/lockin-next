import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { participants, planEvents } from '../db/schema';
import { type FakeIdp, startFakeIdp } from '../../test/fake-idp';
import { Browser, type CreatedPlan, type PlanAnswer, planBody } from '../../test/plan-browser';
import { signIn } from '../../test/sign-in';
import { type TestServer, startTestServer } from '../../test/test-server';

const CLIENT_ID = 'lockin-web';
const SECRET = 'test-secret-'.padEnd(40, 'x');

let idp: FakeIdp;
let server: TestServer;

beforeAll(async () => {
  idp = await startFakeIdp({ clientId: CLIENT_ID, clientSecret: SECRET, sub: 'funnel-creator' });
  server = await startTestServer({ AUTH_ISSUER: idp.issuer, AUTH_CLIENT_SECRET: SECRET });
});
afterAll(async () => {
  await server.close();
  await idp.close();
});

async function signInto(browser: Browser, sub: string): Promise<void> {
  idp.setSub(sub);
  browser.add(await signIn(server));
}

async function create(browser: Browser, extra: Record<string, unknown> = {}): Promise<CreatedPlan> {
  const res = await browser.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(Date.now(), extra)) });
  expect(res.status).toBe(201);
  return (await res.json()) as CreatedPlan;
}

async function eventsOf(planId: string): Promise<Array<typeof planEvents.$inferSelect>> {
  return server.database.db.select().from(planEvents).where(eq(planEvents.planId, planId));
}

const typesOf = (events: Array<{ type: string }>): Record<string, number> =>
  events.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.type]: (acc[e.type] ?? 0) + 1 }), {});

describe('funnel events', () => {
  it('records each step once: link opened per browser, joined, voted, locked, done', async () => {
    const creator = new Browser(server);
    await signInto(creator, 'funnel-creator');
    const created = await create(creator, { creatorDisplayName: 'Minh' });
    const id = created.plan.id ?? '';
    const link = `/api/k/${created.share.token}`;

    // The creator's own opens are not counted.
    await creator.call(link);
    const guest = new Browser(server);
    await guest.call(link);
    await guest.call(link);
    await new Browser(server).call(link);
    for (const name of ['Linh', 'Linh Nguyễn']) await guest.call(`${link}/join`, { method: 'POST', body: JSON.stringify({ displayName: name }) });
    const [t1, t2] = created.plan.options.map((o) => o.id);
    for (const ids of [[t1], [t1, t2]]) await guest.call(`${link}/votes`, { method: 'POST', body: JSON.stringify({ optionIds: ids }) });
    await guest.call(`${link}/rsvp`, { method: 'POST', body: JSON.stringify({ rsvp: 'going' }) });
    const [time, place] = [created.plan.options.find((o) => o.kind === 'time'), created.plan.options.find((o) => o.kind === 'place')];
    await creator.call(`/api/plans/${id}/lock`, { method: 'POST', body: JSON.stringify({ timeOptionId: time?.id, placeOptionId: place?.id }) });
    await creator.call(`/api/plans/${id}/done`, { method: 'POST', body: '{}' });

    const events = await eventsOf(id);
    expect(typesOf(events)).toEqual({ plan_created: 1, joined: 2, link_opened: 2, voted: 1, rsvp: 1, locked: 1, done: 1 });
    expect(events.filter((e) => e.type === 'joined').map((e) => e.actor).sort()).toEqual(['creator', 'participant']);
    expect(events.find((e) => e.type === 'plan_created')?.sourcePlanId).toBeNull();

    // The log holds participant ids, never names.
    const log = JSON.stringify(events);
    for (const name of ['Minh', 'Linh']) expect(log).not.toContain(name);
    const [guestRow] = await server.database.db.select().from(participants).where(eq(participants.displayName, 'Linh Nguyễn'));
    expect(events.find((e) => e.type === 'voted')?.participantId).toBe(guestRow?.id);
  });

  it('logs a cancelled plan', async () => {
    const creator = new Browser(server);
    await signInto(creator, 'funnel-creator');
    const created = await create(creator);
    await creator.call(`/api/plans/${created.plan.id ?? ''}/cancel`, { method: 'POST', body: '{}' });
    expect(typesOf(await eventsOf(created.plan.id ?? ''))).toEqual({ plan_created: 1, cancelled: 1 });
  });

  it('marks the plan a guest joined as the source when that browser later makes a plan of its own', async () => {
    const host = new Browser(server);
    await signInto(host, 'funnel-host');
    const first = await create(host);

    const friend = new Browser(server);
    await friend.call(`/api/k/${first.share.token}`);
    await friend.call(`/api/k/${first.share.token}/join`, { method: 'POST', body: JSON.stringify({ displayName: 'Tú' }) });
    await signInto(friend, 'funnel-friend');
    const own = await create(friend);
    const [made] = (await eventsOf(own.plan.id ?? '')).filter((e) => e.type === 'plan_created');
    expect(made?.sourcePlanId).toBe(first.plan.id);

    // Only opening (not joining) another plan is not a source.
    const visitor = new Browser(server);
    await visitor.call(`/api/k/${first.share.token}`);
    await signInto(visitor, 'funnel-visitor');
    const theirs = await create(visitor);
    expect((await eventsOf(theirs.plan.id ?? '')).find((e) => e.type === 'plan_created')?.sourcePlanId).toBeNull();

    // The guest still is the same person in the first plan after signing in.
    const view = ((await (await friend.call(`/api/k/${first.share.token}`)).json()) as PlanAnswer).plan;
    expect(view.viewer.participantId).not.toBeNull();
  });
});
