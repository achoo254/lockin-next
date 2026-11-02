import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { participants, planEvents, plans } from '../db/schema';
import { type FakeIdp, startFakeIdp } from '../../test/fake-idp';
import { Browser, type CreatedPlan, type PlanAnswer, planBody } from '../../test/plan-browser';
import { location, signIn } from '../../test/sign-in';
import { type TestServer, startTestServer } from '../../test/test-server';
import type { PlanSummaryView } from './plan-view';
import { hashToken } from './tokens';

const CLIENT_ID = 'lockin-web';
const SECRET = 'test-secret-'.padEnd(40, 'x');

let idp: FakeIdp;
let server: TestServer;

beforeAll(async () => {
  idp = await startFakeIdp({ clientId: CLIENT_ID, clientSecret: SECRET, sub: 'owner-a' });
  server = await startTestServer({ AUTH_ISSUER: idp.issuer, AUTH_CLIENT_SECRET: SECRET });
});
afterAll(async () => {
  await server.close();
  await idp.close();
});

const creatorCookie = (planId: string): string => `lockin_c_${planId.replaceAll('-', '')}`;

async function signInto(browser: Browser, sub: string): Promise<Browser> {
  idp.setSub(sub);
  browser.add(await signIn(server));
  return browser;
}

/** A plan made signed out by `browser`, with the creator's name. */
async function guestPlan(browser: Browser, overrides: Record<string, unknown> = {}): Promise<CreatedPlan> {
  const res = await browser.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(Date.now(), { creatorDisplayName: 'Minh', ...overrides })) });
  expect(res.status).toBe(201);
  return (await res.json()) as CreatedPlan;
}

const lockBody = (created: CreatedPlan): string => {
  const pick = (kind: 'time' | 'place'): string | undefined => created.plan.options.find((o) => o.kind === kind)?.id;
  return JSON.stringify({ timeOptionId: pick('time'), placeOptionId: pick('place') });
};

/** The manage link's path and token. */
function manageParts(created: CreatedPlan): { path: string; token: string } {
  const path = new URL(created.manage.url).pathname;
  return { path, token: path.slice(path.indexOf('.') + 1) };
}

const listOf = async (browser: Browser): Promise<PlanSummaryView[]> => ((await (await browser.call('/api/plans')).json()) as { plans: PlanSummaryView[] }).plans;

describe('making a plan signed out', () => {
  it('needs only a name, keeps the creator token in an HttpOnly cookie and returns the manage link', async () => {
    const creator = new Browser(server);
    const res = await creator.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(Date.now(), { creatorDisplayName: 'Minh' })) });
    expect(res.status).toBe(201);
    const created = (await res.json()) as CreatedPlan;
    const id = created.plan.id ?? '';
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${creatorCookie(id)}=`)) ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    const { token } = manageParts(created);
    expect(created.manage.url).toBe(`${server.origin}/m/${id}.${token}`);
    expect(creator.cookie(creatorCookie(id))).toBe(token);
    expect(created.plan).toMatchObject({ creatorName: 'Minh', savedToAccount: false, manage: created.manage, viewer: { isCreator: true } });
    expect(created.plan.participants).toEqual([expect.objectContaining({ displayName: 'Minh', isCreator: true, rsvp: 'going' })]);

    // Only the hash and a sealed copy are stored; the event says how it was made, with no name.
    const [row] = await server.database.db.select().from(plans).where(eq(plans.id, id));
    expect(row).toMatchObject({ creatorSub: null, creatorTokenHash: hashToken(token) });
    expect(JSON.stringify(row)).not.toContain(token);
    const [made] = await server.database.db
      .select()
      .from(planEvents)
      .where(and(eq(planEvents.planId, id), eq(planEvents.type, 'plan_created')));
    expect(made?.payload).toEqual({ creatorKind: 'guest' });

    // The creator's page shows the manage link again; a guest never sees it.
    const page = ((await (await creator.call(`/api/k/${created.share.token}`)).json()) as PlanAnswer).plan;
    expect(page).toMatchObject({ viewer: { isCreator: true }, manage: created.manage, share: created.share });
    const guestView = await (await new Browser(server).call(`/api/k/${created.share.token}`)).text();
    expect(guestView).not.toContain(token);
    expect(guestView).not.toContain('manage');
  });

  it('marks a plan made signed in as the account’s, without a creator cookie', async () => {
    const creator = await signInto(new Browser(server), 'owner-a');
    const res = await creator.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(Date.now())) });
    const created = (await res.json()) as CreatedPlan;
    const id = created.plan.id ?? '';
    expect(creator.cookie(creatorCookie(id))).toBeUndefined();
    expect(created.plan.savedToAccount).toBe(true);
    expect(created.manage.url).toContain(`/m/${id}.`);
    const [made] = await server.database.db
      .select()
      .from(planEvents)
      .where(and(eq(planEvents.planId, id), eq(planEvents.type, 'plan_created')));
    expect(made?.payload).toEqual({ creatorKind: 'account' });
  });

  it('lets the creator cookie lock and cancel; another browser without it cannot', async () => {
    const creator = new Browser(server);
    const created = await guestPlan(creator);
    const id = created.plan.id ?? '';
    const stranger = new Browser(server);
    const other = await signInto(new Browser(server), 'someone-else');
    for (const [path, body] of [
      ['lock', lockBody(created)],
      ['cancel', '{}'],
      ['rotate-link', '{}'],
    ] as const) {
      const byStranger = await stranger.call(`/api/plans/${id}/${path}`, { method: 'POST', body });
      expect([byStranger.status, await byStranger.json()]).toEqual([401, { error: 'sign-in-required' }]);
      const byOther = await other.call(`/api/plans/${id}/${path}`, { method: 'POST', body });
      expect([byOther.status, await byOther.json()]).toEqual([403, { error: 'not-creator' }]);
    }
    // A made-up cookie for the plan is no key.
    const forger = new Browser(server);
    forger.add(`${creatorCookie(id)}=${'A'.repeat(43)}`);
    expect((await forger.call(`/api/plans/${id}/cancel`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await forger.call(`/api/plans/${id}`)).status).toBe(401);

    const locked = await creator.call(`/api/plans/${id}/lock`, { method: 'POST', body: lockBody(created) });
    expect(locked.status).toBe(200);
    expect(((await locked.json()) as PlanAnswer).plan.status).toBe('locked');
    const cancelled = await creator.call(`/api/plans/${id}/cancel`, { method: 'POST', body: '{}' });
    expect(((await cancelled.json()) as PlanAnswer).plan.status).toBe('cancelled');
  });

  it('hands the creator’s rights to a new browser through the manage link, without the token in the address', async () => {
    const created = await guestPlan(new Browser(server));
    const id = created.plan.id ?? '';
    const { path, token } = manageParts(created);
    const phone = new Browser(server);
    const open = await phone.call(path, { redirect: 'manual' });
    expect(open.status).toBe(303);
    expect(location(open)).toBe(`/k/${created.share.token}`);
    expect(location(open)).not.toContain(token);
    expect(open.headers.get('referrer-policy')).toBe('no-referrer');
    expect(open.headers.get('cache-control')).toBe('no-store');
    expect(phone.cookie(creatorCookie(id))).toBe(token);
    const page = ((await (await phone.call(`/api/k/${created.share.token}`)).json()) as PlanAnswer).plan;
    expect(page.viewer.isCreator).toBe(true);
    // The creator's participant row is the same one on the new browser.
    expect(page.viewer.participantId).toBe(created.plan.viewer.participantId);
    expect((await phone.call(`/api/plans/${id}/lock`, { method: 'POST', body: lockBody(created) })).status).toBe(200);

    // A wrong token, a malformed link and a missing plan: the same redirect home, no cookie.
    for (const bad of [`/m/${id}.${'B'.repeat(43)}`, `/m/${id}`, '/m/not-a-link', `/m/00000000-0000-4000-8000-000000000000.${token}`]) {
      const browser = new Browser(server);
      const res = await browser.call(bad, { redirect: 'manual' });
      expect([res.status, location(res)]).toEqual([303, '/?manage=invalid']);
      expect(browser.cookieNames()).toEqual([]);
    }
  });

  it('refuses a plan made signed out without a creator name', async () => {
    const res = await new Browser(server).call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(Date.now())) });
    expect([res.status, await res.json()]).toEqual([400, { error: 'name-required' }]);
  });
});

describe('saving a plan to an account', () => {
  it('attaches the plan to the signed-in account once, from the cookie or the manage link, and never steals it', async () => {
    const browser = new Browser(server);
    const created = await guestPlan(browser);
    const id = created.plan.id ?? '';
    const claim = (by: Browser, body: unknown = {}): Promise<Response> => by.call(`/api/plans/${id}/claim`, { method: 'POST', body: JSON.stringify(body) });

    // Signed out: sign in first.
    expect([(await claim(browser)).status]).toEqual([401]);
    // Signed in without the key: not theirs to take.
    const keyless = await signInto(new Browser(server), 'owner-b');
    expect((await claim(keyless)).status).toBe(403);

    await signInto(browser, 'owner-b');
    const first = await claim(browser);
    expect(first.status).toBe(200);
    expect(((await first.json()) as PlanAnswer).plan).toMatchObject({ savedToAccount: true, viewer: { isCreator: true } });
    // Again: nothing changes, nothing more is logged.
    expect((await claim(browser)).status).toBe(200);
    const [row] = await server.database.db.select().from(plans).where(eq(plans.id, id));
    expect(row?.creatorSub).toBe('owner-b');
    const [creatorRow] = await server.database.db
      .select()
      .from(participants)
      .where(and(eq(participants.planId, id), eq(participants.isCreator, true)));
    expect(creatorRow?.creatorSub).toBe('owner-b');
    const claimed = await server.database.db
      .select()
      .from(planEvents)
      .where(and(eq(planEvents.planId, id), eq(planEvents.type, 'plan_claimed')));
    expect(claimed).toHaveLength(1);

    // Another account holding the manage link cannot take it over.
    const thief = await signInto(new Browser(server), 'owner-c');
    const stolen = await claim(thief, { token: manageParts(created).token });
    expect([stolen.status, await stolen.json()]).toEqual([409, { error: 'plan-owned' }]);

    // The account manages it from a browser with no cookie at all, and sees it in its list.
    const laptop = await signInto(new Browser(server), 'owner-b');
    expect((await laptop.call(`/api/plans/${id}`)).status).toBe(200);
    expect((await listOf(laptop)).map((p) => [p.id, p.savedToAccount])).toContainEqual([id, true]);
    expect((await laptop.call(`/api/plans/${id}/lock`, { method: 'POST', body: lockBody(created) })).status).toBe(200);
  });

  it('takes the manage link’s token in the body on a browser without the cookie', async () => {
    const created = await guestPlan(new Browser(server));
    const id = created.plan.id ?? '';
    const elsewhere = await signInto(new Browser(server), 'owner-d');
    const res = await elsewhere.call(`/api/plans/${id}/claim`, { method: 'POST', body: JSON.stringify({ token: manageParts(created).token }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as PlanAnswer).plan.savedToAccount).toBe(true);
    const bad = await elsewhere.call(`/api/plans/${id}/claim`, { method: 'POST', body: JSON.stringify({ token: 'short' }) });
    expect(bad.status).toBe(400);
  });
});

describe('“Kèo của tôi”', () => {
  it('lists the account’s plans and the plans whose creator cookie this browser holds', async () => {
    const browser = new Browser(server);
    const here = await guestPlan(browser, { title: 'Kèo trên trình duyệt' });
    // Signed out: the browser's own plans.
    expect((await listOf(browser)).map((p) => [p.title, p.savedToAccount])).toEqual([['Kèo trên trình duyệt', false]]);

    const account = await signInto(new Browser(server), 'owner-list');
    const res = await account.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(Date.now(), { title: 'Kèo của tài khoản' })) });
    expect(res.status).toBe(201);
    await signInto(browser, 'owner-list');
    expect((await listOf(browser)).map((p) => [p.title, p.savedToAccount]).sort()).toEqual([
      ['Kèo của tài khoản', true],
      ['Kèo trên trình duyệt', false],
    ]);
    // Neither shows up anywhere else.
    expect(await listOf(new Browser(server))).toEqual([]);
    const forger = new Browser(server);
    forger.add(`${creatorCookie(here.plan.id ?? '')}=${'C'.repeat(43)}`);
    expect(await listOf(forger)).toEqual([]);
  });
});

describe('limits on making plans signed out', () => {
  const opened: TestServer[] = [];
  let limitedIdp: FakeIdp;
  beforeAll(async () => {
    limitedIdp = await startFakeIdp({ clientId: CLIENT_ID, clientSecret: SECRET, sub: 'limited-account' });
  });
  afterAll(async () => {
    for (const s of opened) await s.close();
    await limitedIdp.close();
  });

  async function limitedServer(limits: { hour: number; day: number }): Promise<TestServer> {
    const s = await startTestServer(
      { AUTH_ISSUER: limitedIdp.issuer, AUTH_CLIENT_SECRET: SECRET },
      { guestPlanCreateLimitPerHourPerIp: limits.hour, guestPlanCreateLimitPerDayPerIp: limits.day, planCreateLimitPerHour: 5 },
    );
    opened.push(s);
    return s;
  }

  /** Statuses of `n` plans made signed out, each from a new browser at the same address. */
  async function makeSignedOut(s: TestServer, n: number): Promise<number[]> {
    const body = JSON.stringify(planBody(Date.now(), { creatorDisplayName: 'Khách' }));
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push((await new Browser(s).call('/api/plans', { method: 'POST', body })).status);
    return out;
  }

  it('counts plans made signed out per IP and hour, apart from accounts at the same address', async () => {
    const s = await limitedServer({ hour: 2, day: 50 });
    expect(await makeSignedOut(s, 3)).toEqual([201, 201, 429]);
    const account = new Browser(s);
    account.add(await signIn(s));
    const body = JSON.stringify(planBody(Date.now()));
    const made: number[] = [];
    for (let i = 0; i < 2; i++) made.push((await account.call('/api/plans', { method: 'POST', body })).status);
    expect(made).toEqual([201, 201]);
  });

  it('caps plans made signed out per IP and day', async () => {
    const s = await limitedServer({ hour: 50, day: 2 });
    expect(await makeSignedOut(s, 3)).toEqual([201, 201, 429]);
  });
});
