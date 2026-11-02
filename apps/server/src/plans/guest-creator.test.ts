import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { participants, planEvents, plans } from '../db/schema';
import { type FakeIdp, startFakeIdp } from '../../test/fake-idp';
import { Browser, type CreatedPlan, type PlanAnswer, planBody } from '../../test/plan-browser';
import { location, signIn } from '../../test/sign-in';
import { type TestServer, startTestServer } from '../../test/test-server';
import { PLAN_COOKIE_ROOM } from './retention';
import type { PlanSummaryView } from './plan-view';
import { hashToken } from './tokens';

const CLIENT_ID = 'lockin-web';
const SECRET = 'test-secret-'.padEnd(40, 'x');

let idp: FakeIdp;
let server: TestServer;

beforeAll(async () => {
  idp = await startFakeIdp({ clientId: CLIENT_ID, clientSecret: SECRET, sub: 'owner-a' });
  // Many plans are made signed out from one address here; the limits have tests of their own below.
  server = await startTestServer({ AUTH_ISSUER: idp.issuer, AUTH_CLIENT_SECRET: SECRET }, { guestPlanCreateLimitPerHourPerIp: 100, guestPlanCreateLimitPerDayPerIp: 100 });
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

/** The path and token of a manage link. */
function linkParts(url: string): { path: string; token: string } {
  const path = new URL(url).pathname;
  return { path, token: path.slice(path.indexOf('.') + 1) };
}

/** The manage link's path and token of a plan made signed out. */
function manageParts(created: CreatedPlan): { path: string; token: string } {
  if (!created.manage) throw new Error('a plan made signed out has a manage link');
  return linkParts(created.manage.url);
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
    expect(created.manage?.url).toBe(`${server.origin}/m/${id}.${token}`);
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

  it('marks a plan made signed in as the account’s, without a creator token, cookie or manage link', async () => {
    const creator = await signInto(new Browser(server), 'owner-a');
    const res = await creator.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(Date.now())) });
    const created = (await res.json()) as CreatedPlan;
    const id = created.plan.id ?? '';
    expect(creator.cookie(creatorCookie(id))).toBeUndefined();
    expect(created.plan.savedToAccount).toBe(true);
    expect([created.manage, created.plan.manage]).toEqual([null, null]);
    const [row] = await server.database.db.select().from(plans).where(eq(plans.id, id));
    expect(row).toMatchObject({ creatorTokenHash: null, manageTokenEnc: null });
    // The account is its only key: there is no manage link to change.
    const rotate = await creator.call(`/api/plans/${id}/rotate-manage`, { method: 'POST', body: '{}' });
    expect([rotate.status, await rotate.json()]).toEqual([409, { error: 'no-manage-link' }]);
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

    // Another account holding the old manage link cannot take it over: the link died with the save.
    const thief = await signInto(new Browser(server), 'owner-c');
    const stolen = await claim(thief, { token: manageParts(created).token });
    expect([stolen.status, await stolen.json()]).toEqual([403, { error: 'not-creator' }]);

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

describe('the account is the key once a plan is saved to it', () => {
  it('replaces the manage link on saving and drops the saving browser’s creator cookie; old keys open nothing', async () => {
    const maker = new Browser(server);
    const created = await guestPlan(maker);
    const id = created.plan.id ?? '';
    const old = manageParts(created);
    // A second browser got in through the manage link before the save.
    const phone = new Browser(server);
    await phone.call(old.path, { redirect: 'manual' });
    expect(phone.cookie(creatorCookie(id))).toBe(old.token);

    await signInto(maker, 'owner-key');
    const res = await maker.call(`/api/plans/${id}/claim`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    const saved = ((await res.json()) as PlanAnswer).plan;
    expect(maker.cookie(creatorCookie(id))).toBeUndefined();
    // The account sees the new link; the token behind it is not the old one.
    const fresh = linkParts(saved.manage?.url ?? '');
    expect(fresh.token).not.toBe(old.token);
    const [row] = await server.database.db.select().from(plans).where(eq(plans.id, id));
    expect(row?.creatorTokenHash).toBe(hashToken(fresh.token));

    // The old link is dead, like a wrong one.
    const stale = new Browser(server);
    const reopened = await stale.call(old.path, { redirect: 'manual' });
    expect([reopened.status, location(reopened)]).toEqual([303, '/?manage=invalid']);
    // The phone's old cookie opens nothing: signed out it is asked to sign in, under another account it is refused.
    expect((await phone.call(`/api/plans/${id}`)).status).toBe(401);
    const page = ((await (await phone.call(`/api/k/${created.share.token}`)).json()) as PlanAnswer).plan;
    expect(page.viewer.isCreator).toBe(false);
    await signInto(phone, 'not-the-owner');
    const refused = await phone.call(`/api/plans/${id}/cancel`, { method: 'POST', body: '{}' });
    expect([refused.status, await refused.json()]).toEqual([403, { error: 'not-creator' }]);

    // The new link, even handed to someone, sets no cookie and only leads to the plan's creator page (sign in there).
    const holder = new Browser(server);
    const opened = await holder.call(fresh.path, { redirect: 'manual' });
    expect([opened.status, location(opened)]).toEqual([303, `/plans/${id}`]);
    expect(holder.cookieNames()).toEqual([]);
    expect((await holder.call(`/api/plans/${id}`)).status).toBe(401);
    // Another account holding the new link still cannot take the plan.
    const thief = await signInto(new Browser(server), 'owner-thief');
    const stolen = await thief.call(`/api/plans/${id}/claim`, { method: 'POST', body: JSON.stringify({ token: fresh.token }) });
    expect([stolen.status, await stolen.json()]).toEqual([409, { error: 'plan-owned' }]);
    // The owner still manages it.
    expect((await maker.call(`/api/plans/${id}/lock`, { method: 'POST', body: lockBody(created) })).status).toBe(200);
  });

  it('drops the creator cookies of plans saved to an account on sign-out, and keeps the others', async () => {
    const browser = new Browser(server);
    const kept = await guestPlan(browser, { title: 'Còn trên trình duyệt' });
    const savedElsewhere = await guestPlan(new Browser(server), { title: 'Lưu ở máy khác' });
    const savedId = savedElsewhere.plan.id ?? '';
    // This browser holds the old cookie of a plan another browser saves to an account.
    await browser.call(manageParts(savedElsewhere).path, { redirect: 'manual' });
    const owner = await signInto(new Browser(server), 'owner-logout');
    expect((await owner.call(`/api/plans/${savedId}/claim`, { method: 'POST', body: JSON.stringify({ token: manageParts(savedElsewhere).token }) })).status).toBe(200);

    await signInto(browser, 'someone-logging-out');
    expect((await browser.call('/auth/logout', { method: 'POST' })).status).toBe(204);
    expect(browser.cookie(creatorCookie(savedId))).toBeUndefined();
    expect(browser.cookie(creatorCookie(kept.plan.id ?? ''))).toBe(manageParts(kept).token);
  });
});

describe('changing the manage link', () => {
  it('gives the creator a new link, keeps this browser in and shuts out the old link and other cookies', async () => {
    const maker = new Browser(server);
    const created = await guestPlan(maker);
    const id = created.plan.id ?? '';
    const old = manageParts(created);
    const laptop = new Browser(server);
    await laptop.call(old.path, { redirect: 'manual' });

    // Only the creator may.
    const stranger = await new Browser(server).call(`/api/plans/${id}/rotate-manage`, { method: 'POST', body: '{}' });
    expect([stranger.status, await stranger.json()]).toEqual([401, { error: 'sign-in-required' }]);
    const other = await signInto(new Browser(server), 'not-the-maker');
    expect((await other.call(`/api/plans/${id}/rotate-manage`, { method: 'POST', body: '{}' })).status).toBe(403);

    const res = await maker.call(`/api/plans/${id}/rotate-manage`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    const { manage } = (await res.json()) as { manage: { url: string } };
    const fresh = linkParts(manage.url);
    expect(manage.url).toBe(`${server.origin}/m/${id}.${fresh.token}`);
    expect(fresh.token).not.toBe(old.token);
    expect(maker.cookie(creatorCookie(id))).toBe(fresh.token);
    expect((await maker.call(`/api/plans/${id}`)).status).toBe(200);
    // The other browser's cookie and the old link no longer work; the new link does.
    expect((await laptop.call(`/api/plans/${id}`)).status).toBe(401);
    const reopened = await new Browser(server).call(old.path, { redirect: 'manual' });
    expect(location(reopened)).toBe('/?manage=invalid');
    const tablet = new Browser(server);
    expect(location(await tablet.call(fresh.path, { redirect: 'manual' }))).toBe(`/k/${created.share.token}`);
    expect((await tablet.call(`/api/plans/${id}`)).status).toBe(200);
    // Logged, without the token.
    const logged = await server.database.db
      .select()
      .from(planEvents)
      .where(and(eq(planEvents.planId, id), eq(planEvents.type, 'manage_link_rotated')));
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain(fresh.token);
  });

  it('lets the owning account change the link of a saved plan; the cookie of the plan is not handed out', async () => {
    const maker = new Browser(server);
    const created = await guestPlan(maker);
    const id = created.plan.id ?? '';
    await signInto(maker, 'owner-rotates');
    await maker.call(`/api/plans/${id}/claim`, { method: 'POST', body: '{}' });
    const before = ((await (await maker.call(`/api/plans/${id}`)).json()) as PlanAnswer).plan.manage?.url;
    const res = await maker.call(`/api/plans/${id}/rotate-manage`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    const { manage } = (await res.json()) as { manage: { url: string } };
    expect(manage.url).not.toBe(before);
    expect(maker.cookie(creatorCookie(id))).toBeUndefined();
    expect(((await (await maker.call(`/api/plans/${id}`)).json()) as PlanAnswer).plan.manage?.url).toBe(manage.url);
  });
});

describe('a creator who also joined as a guest', () => {
  it('is one participant once the manage link gets them in: the guest’s votes go to the creator’s row', async () => {
    const created = await guestPlan(new Browser(server));
    const id = created.plan.id ?? '';
    const [time, place] = [created.plan.options.find((o) => o.kind === 'time'), created.plan.options.find((o) => o.kind === 'place')];
    // The maker votes a time as the creator; from a laptop they had joined as a guest and voted a place.
    const maker = new Browser(server);
    await maker.call(manageParts(created).path, { redirect: 'manual' });
    await maker.call(`/api/k/${created.share.token}/votes`, { method: 'POST', body: JSON.stringify({ optionIds: [time?.id] }) });
    const laptop = new Browser(server);
    await laptop.call(`/api/k/${created.share.token}/join`, { method: 'POST', body: JSON.stringify({ displayName: 'Minh (laptop)' }) });
    await laptop.call(`/api/k/${created.share.token}/votes`, { method: 'POST', body: JSON.stringify({ optionIds: [place?.id] }) });
    await laptop.call(`/api/k/${created.share.token}/rsvp`, { method: 'POST', body: JSON.stringify({ rsvp: 'maybe' }) });
    const guestCookie = `lockin_g_${id.replaceAll('-', '')}`;
    expect(laptop.cookie(guestCookie)).toBeDefined();

    await laptop.call(manageParts(created).path, { redirect: 'manual' });
    const page = ((await (await laptop.call(`/api/k/${created.share.token}`)).json()) as PlanAnswer).plan;
    expect(page.viewer.isCreator).toBe(true);
    expect(page.participants).toEqual([
      expect.objectContaining({ displayName: 'Minh', isCreator: true, rsvp: 'going', optionIds: expect.arrayContaining([time?.id, place?.id]) as unknown }),
    ]);
    expect(page.viewer.participantId).toBe(created.plan.viewer.participantId);
    expect(laptop.cookie(guestCookie)).toBeUndefined();
    const merged = await server.database.db
      .select()
      .from(planEvents)
      .where(and(eq(planEvents.planId, id), eq(planEvents.type, 'guest_merged')));
    expect(merged).toHaveLength(1);
  });

  it('turns the guest’s row into the creator’s when the creator had not joined: the owner signing in on that browser', async () => {
    const owner = await signInto(new Browser(server), 'owner-no-name');
    const created = (await (await owner.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(Date.now())) })).json()) as CreatedPlan;
    expect(created.plan.participants).toEqual([]);
    const browser = new Browser(server);
    await browser.call(`/api/k/${created.share.token}/join`, { method: 'POST', body: JSON.stringify({ displayName: 'Chủ kèo' }) });
    await browser.call(`/api/k/${created.share.token}/rsvp`, { method: 'POST', body: JSON.stringify({ rsvp: 'going' }) });

    await signInto(browser, 'owner-no-name');
    const page = ((await (await browser.call(`/api/k/${created.share.token}`)).json()) as PlanAnswer).plan;
    expect(page.viewer.isCreator).toBe(true);
    expect(page.creatorName).toBe('Chủ kèo');
    expect(page.participants).toEqual([expect.objectContaining({ displayName: 'Chủ kèo', isCreator: true, rsvp: 'going' })]);
    const [row] = await server.database.db.select().from(participants).where(eq(participants.planId, created.plan.id ?? ''));
    expect(row).toMatchObject({ guestTokenHash: null, creatorSub: 'owner-no-name', isCreator: true });
  });
});

describe('a browser in many plans', () => {
  it('expires a stale guest cookie before setting one more past the room', async () => {
    const created = await guestPlan(new Browser(server));
    const browser = new Browser(server);
    const fake = (i: number): string => `lockin_g_${i.toString(16).padStart(32, '0')}`;
    // Cookies of plans that no longer exist, oldest first.
    for (let i = 0; i < PLAN_COOKIE_ROOM; i++) browser.add(`${fake(i)}=${'G'.repeat(43)}`);
    const res = await browser.call(`/api/k/${created.share.token}/join`, { method: 'POST', body: JSON.stringify({ displayName: 'Lan' }) });
    expect(res.status).toBe(200);
    expect(browser.cookie(fake(0))).toBeUndefined();
    expect(browser.cookie(fake(1))).toBeDefined();
    expect(browser.cookie(`lockin_g_${(created.plan.id ?? '').replaceAll('-', '')}`)).toBeDefined();
    expect(browser.cookieNames().filter((name) => name.startsWith('lockin_g_'))).toHaveLength(PLAN_COOKIE_ROOM);
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
