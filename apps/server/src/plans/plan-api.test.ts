import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { participants, planEvents, plans, votes } from '../db/schema';
import { type FakeIdp, startFakeIdp } from '../../test/fake-idp';
import { Browser, type CreatedPlan, type PlanAnswer, planBody } from '../../test/plan-browser';
import { api, signIn } from '../../test/sign-in';
import { type TestServer, startTestServer } from '../../test/test-server';
import { hashToken } from './tokens';

const CLIENT_ID = 'lockin-web';
const SECRET = 'test-secret-'.padEnd(40, 'x');
const HOUR = 60 * 60 * 1000;

let idp: FakeIdp;
let server: TestServer;
/** The app's clock: tests move it past deadlines. */
let clock = Date.now();

beforeAll(async () => {
  idp = await startFakeIdp({ clientId: CLIENT_ID, clientSecret: SECRET, sub: 'creator-a' });
  server = await startTestServer({ AUTH_ISSUER: idp.issuer, AUTH_CLIENT_SECRET: SECRET }, {}, () => new Date(clock));
});
afterAll(async () => {
  await server.close();
  await idp.close();
});

async function signedIn(sub: string): Promise<Browser> {
  idp.setSub(sub);
  const browser = new Browser(server);
  browser.add(await signIn(server));
  return browser;
}

async function newPlan(creator: Browser, overrides: Record<string, unknown> = {}): Promise<CreatedPlan> {
  const res = await creator.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(clock, overrides)) });
  expect(res.status).toBe(201);
  return (await res.json()) as CreatedPlan;
}

/** A guest that opened the link and joined. */
async function joinedGuest(token: string, name: string): Promise<{ browser: Browser; participantId: string }> {
  const browser = new Browser(server);
  expect((await browser.call(`/api/k/${token}`)).status).toBe(200);
  const res = await browser.call(`/api/k/${token}/join`, { method: 'POST', body: JSON.stringify({ displayName: name }) });
  expect(res.status).toBe(200);
  const { plan } = (await res.json()) as PlanAnswer;
  if (!plan.viewer.participantId) throw new Error('join gave no participant');
  return { browser, participantId: plan.viewer.participantId };
}

const optionIds = (created: CreatedPlan, kind: 'time' | 'place'): string[] => created.plan.options.filter((o) => o.kind === kind).map((o) => o.id);

describe('creating and listing plans', () => {
  it('makes a plan with its options, stores only the hash of the share token, and lets the creator join it', async () => {
    const creator = await signedIn('creator-a');
    const created = await newPlan(creator, { creatorDisplayName: 'Minh' });
    expect(created.share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.share.url).toBe(`${server.origin}/k/${created.share.token}`);
    expect(created.plan).toMatchObject({ title: 'Cà phê thứ Bảy', activity: 'coffee', area: 'Quận 3', budgetPerPerson: 60000, status: 'open', creatorName: 'Minh' });
    expect(created.plan.options.map((o) => [o.kind, o.label])).toEqual([
      ['time', ''],
      ['time', ''],
      ['place', 'Quán cà phê A'],
      ['place', 'Quán cà phê B'],
    ]);
    expect(created.plan.participants).toEqual([{ id: created.plan.viewer.participantId, displayName: 'Minh', rsvp: 'going', isCreator: true, optionIds: [] }]);
    const id = created.plan.id ?? '';
    const [row] = await server.database.db.select().from(plans).where(eq(plans.id, id));
    expect(row?.shareTokenHash).toBe(hashToken(created.share.token));
    expect(JSON.stringify(row)).not.toContain(created.share.token);
  });

  it('counts the creator as going from the start, without a vote, and lets them change it', async () => {
    const creator = await signedIn('creator-a');
    const created = await newPlan(creator, { creatorDisplayName: 'Minh' });
    const me = created.plan.viewer.participantId;
    const [creatorRow] = await server.database.db.select().from(participants).where(eq(participants.planId, created.plan.id ?? ''));
    expect(creatorRow).toMatchObject({ rsvp: 'going', creatorSub: 'creator-a' });
    // Going is no vote: the creator picked nothing yet.
    expect(created.plan.options.every((o) => o.votes === 0)).toBe(true);
    // No rsvp event: nobody tapped anything.
    const events = await server.database.db.select().from(planEvents).where(eq(planEvents.planId, created.plan.id ?? ''));
    expect(events.map((e) => e.type).sort()).toEqual(['joined', 'plan_created']);

    const changed = await creator.call(`/api/k/${created.share.token}/rsvp`, { method: 'POST', body: JSON.stringify({ rsvp: 'no' }) });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as PlanAnswer).plan.participants.find((p) => p.id === me)).toMatchObject({ rsvp: 'no', isCreator: true });

    // Without a name the creator has not joined, so there is no one to count.
    const nameless = await newPlan(creator);
    expect(nameless.plan.participants).toEqual([]);
  });

  it('refuses a plan made signed out without a name, with a bad body, or with a deadline in the past', async () => {
    const anonymous = new Browser(server);
    const body = JSON.stringify(planBody(clock));
    // Signed out, a plan needs the creator's name.
    expect(await (await anonymous.call('/api/plans', { method: 'POST', body })).json()).toEqual({ error: 'name-required' });
    const creator = await signedIn('creator-a');
    for (const bad of [{ title: '' }, { activity: 'rave' }, { options: [] }, { budgetPerPerson: -1 }, { unknown: 1 }, { title: 'two\nlines' }]) {
      const res = await creator.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(clock, bad)) });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid-body' });
    }
    const past = await creator.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(clock, { voteDeadline: new Date(clock - HOUR).toISOString() })) });
    expect(await past.json()).toEqual({ error: 'invalid-deadline' });
  });

  it('keeps the names of the people the creator expects, without repeats, and refuses too many or bad ones', async () => {
    const creator = await signedIn('creator-names');
    const made = await newPlan(creator, { memberNames: ['Linh', ' Vy ', 'linh', 'Hùng Béo'] });
    expect(made.plan.memberNames).toEqual(['Linh', 'Vy', 'Hùng Béo']);
    expect((await newPlan(creator)).plan.memberNames).toEqual([]);
    for (const memberNames of [Array.from({ length: 51 }, (_, i) => `Bạn ${i}`), ['x'.repeat(41)], ['two\nlines'], ['']]) {
      const res = await creator.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(clock, { memberNames })) });
      expect(res.status).toBe(400);
    }
  });

  it('takes a plan with ten places, each with a full-length Google Maps desktop link', async () => {
    const creator = await signedIn('creator-maps');
    const places = Array.from({ length: 10 }, (_, i) => ({
      kind: 'place',
      label: `Quán ${i}`,
      mapUrl: `https://www.google.com/maps/place/${`Qu%C3%A1n+${i}+`.padEnd(2000, 'x')}`,
    }));
    const body = JSON.stringify(planBody(clock, { options: [{ kind: 'time', startsAt: new Date(clock + 48 * HOUR).toISOString() }, ...places] }));
    expect(body.length).toBeGreaterThan(8 * 1024);
    expect((await creator.call('/api/plans', { method: 'POST', body })).status).toBe(201);
  });

  it('lists only the creator’s own plans and keeps other accounts out of them', async () => {
    const mine = await signedIn('creator-list');
    const created = await newPlan(mine, { title: 'Ăn tối', activity: 'dinner' });
    const list = (await (await mine.call('/api/plans')).json()) as { plans: Array<{ id: string; title: string; participantCount: number }> };
    expect(list.plans).toEqual([expect.objectContaining({ id: created.plan.id, title: 'Ăn tối', participantCount: 0 })]);

    // The creator who joined their own plan is not counted; a guest is.
    const joinedByCreator = await newPlan(mine, { title: 'Cà phê', creatorDisplayName: 'Minh' });
    const count = async (): Promise<number | undefined> =>
      ((await (await mine.call('/api/plans')).json()) as typeof list).plans.find((p) => p.id === joinedByCreator.plan.id)?.participantCount;
    expect(await count()).toBe(0);
    await joinedGuest(joinedByCreator.share.token, 'Linh');
    expect(await count()).toBe(1);

    const other = await signedIn('someone-else');
    expect(await (await other.call('/api/plans')).json()).toEqual({ plans: [] });
    const peek = await other.call(`/api/plans/${created.plan.id ?? ''}`);
    expect(peek.status).toBe(403);
    expect(await peek.json()).toEqual({ error: 'not-creator' });
    expect((await mine.call('/api/plans/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await mine.call('/api/plans/not-a-uuid')).status).toBe(404);
    // A browser with no account and no plan of its own has nothing to list.
    expect(await (await new Browser(server).call('/api/plans')).json()).toEqual({ plans: [] });
  });
});

describe('the plan page for guests', () => {
  it('lets a guest open, join, vote, say whether they go and rename, without an account', async () => {
    const creator = await signedIn('creator-a');
    const created = await newPlan(creator, { creatorDisplayName: 'Minh' });
    const guest = new Browser(server);
    const opened = await guest.call(`/api/k/${created.share.token}`);
    expect(opened.status).toBe(200);
    expect(opened.headers.get('cache-control')).toBe('no-store');
    // Only reading sets no cookie: a browser does not collect one per plan it looked at.
    expect(opened.headers.getSetCookie()).toEqual([]);
    const view = ((await opened.json()) as PlanAnswer).plan;
    expect(view.id).toBeUndefined();
    expect(view.viewer).toEqual({ isCreator: false, participantId: null });
    expect(view.can).toMatchObject({ join: true, vote: true, lock: false, cancel: false, rotateLink: false });

    const join = await guest.call(`/api/k/${created.share.token}/join`, { method: 'POST', body: JSON.stringify({ displayName: '  Linh ' }) });
    const me = ((await join.json()) as PlanAnswer).plan.viewer.participantId;
    // Joining hands out the guest cookie, until the plan turns read-only.
    const setCookie = join.headers.getSetCookie().join('\n');
    expect(setCookie).toMatch(/lockin_g_[0-9a-f]{32}=[A-Za-z0-9_-]{43}; Max-Age=\d+; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax/);
    const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)?.[1]);
    const readOnlyIn = (new Date(created.plan.readOnlyAt).getTime() - clock) / 1000;
    expect(Math.abs(maxAge - readOnlyIn)).toBeLessThan(5);
    expect(me).toEqual(expect.any(String));
    const [time] = optionIds(created, 'time');
    const [, place] = optionIds(created, 'place');
    const voted = await guest.call(`/api/k/${created.share.token}/votes`, { method: 'POST', body: JSON.stringify({ optionIds: [time, place] }) });
    expect(voted.status).toBe(200);
    const rsvp = await guest.call(`/api/k/${created.share.token}/rsvp`, { method: 'POST', body: JSON.stringify({ rsvp: 'going' }) });
    const afterRsvp = ((await rsvp.json()) as PlanAnswer).plan;
    expect(afterRsvp.participants.find((p) => p.id === me)).toEqual({ id: me, displayName: 'Linh', rsvp: 'going', isCreator: false, optionIds: [time, place] });
    expect(afterRsvp.options.filter((o) => o.votes === 1).map((o) => o.id)).toEqual([time, place]);

    // Saying "no" keeps the saved picks but drops them from the tally.
    const declined = await guest.call(`/api/k/${created.share.token}/rsvp`, { method: 'POST', body: JSON.stringify({ rsvp: 'no' }) });
    const afterNo = ((await declined.json()) as PlanAnswer).plan;
    expect(afterNo.participants.find((p) => p.id === me)?.optionIds).toEqual([time, place]);
    expect(afterNo.options.every((o) => o.votes === 0)).toBe(true);
    await guest.call(`/api/k/${created.share.token}/rsvp`, { method: 'POST', body: JSON.stringify({ rsvp: 'going' }) });

    // Renaming keeps the participant (and its votes).
    const renamed = await guest.call(`/api/k/${created.share.token}/join`, { method: 'POST', body: JSON.stringify({ displayName: 'Linh Ng' }) });
    const afterRename = ((await renamed.json()) as PlanAnswer).plan;
    expect(afterRename.viewer.participantId).toBe(me);
    expect(afterRename.participants.filter((p) => !p.isCreator)).toEqual([expect.objectContaining({ id: me, displayName: 'Linh Ng', optionIds: [time, place] })]);

    // Another browser is another person.
    const second = await joinedGuest(created.share.token, 'Linh');
    expect(second.participantId).not.toBe(me);
  });

  it('never shows guests the creator’s account, token hashes or join times', async () => {
    const creator = await signedIn('creator-secret-sub');
    const created = await newPlan(creator, { creatorDisplayName: 'Minh' });
    const { browser } = await joinedGuest(created.share.token, 'Tú');
    const text = await (await browser.call(`/api/k/${created.share.token}`)).text();
    const [row] = await server.database.db.select().from(plans).where(eq(plans.id, created.plan.id ?? ''));
    const people = await server.database.db.select().from(participants).where(eq(participants.planId, created.plan.id ?? ''));
    expect(text).not.toContain('creator-secret-sub');
    expect(text).not.toContain(row?.shareTokenHash ?? 'missing');
    expect(text).not.toContain(created.plan.id ?? 'missing');
    for (const person of people) {
      if (person.guestTokenHash) expect(text).not.toContain(person.guestTokenHash);
      expect(text).not.toContain(person.joinedAt.toISOString());
    }
    expect(text).not.toMatch(/joinedAt|creatorSub|Hash/);
  });

  it('answers a wrong, malformed or rotated link exactly like a missing plan', async () => {
    const creator = await signedIn('creator-a');
    const created = await newPlan(creator);
    const guest = new Browser(server);
    const answers = await Promise.all(
      [`/api/k/${'A'.repeat(43)}`, '/api/k/short', `/api/k/${created.share.token}x`, `/api/k/${'B'.repeat(43)}/join`].map(async (path) => {
        const res = await guest.call(path, path.endsWith('/join') ? { method: 'POST', body: JSON.stringify({ displayName: 'X' }) } : {});
        return [res.status, await res.text()];
      }),
    );
    for (const answer of answers) expect(answer).toEqual([404, '{"error":"not-found"}']);
  });

  it('refuses votes before joining and options of another plan', async () => {
    const creator = await signedIn('creator-a');
    const created = await newPlan(creator);
    const other = await newPlan(creator);
    const stranger = new Browser(server);
    await stranger.call(`/api/k/${created.share.token}`);
    const early = await stranger.call(`/api/k/${created.share.token}/votes`, { method: 'POST', body: JSON.stringify({ optionIds: optionIds(created, 'time') }) });
    expect([early.status, await early.json()]).toEqual([409, { error: 'not-joined' }]);
    const { browser } = await joinedGuest(created.share.token, 'Hà');
    const foreign = await browser.call(`/api/k/${created.share.token}/votes`, { method: 'POST', body: JSON.stringify({ optionIds: optionIds(other, 'time') }) });
    expect([foreign.status, await foreign.json()]).toEqual([400, { error: 'invalid-option' }]);
  });

  it('stores no duplicate votes from concurrent submissions or a double submit', async () => {
    const creator = await signedIn('creator-a');
    const created = await newPlan(creator);
    const { browser, participantId } = await joinedGuest(created.share.token, 'Nam');
    const [t1, t2] = optionIds(created, 'time');
    const [p1] = optionIds(created, 'place');
    const same = JSON.stringify({ optionIds: [t1, p1] });
    const results = await Promise.all(Array.from({ length: 6 }, () => browser.call(`/api/k/${created.share.token}/votes`, { method: 'POST', body: same })));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const db = server.database.db;
    const stored = await db.select().from(votes).where(eq(votes.participantId, participantId));
    expect(stored.map((v) => v.optionId).sort()).toEqual([t1, p1].sort());

    // Two different sets at once: whichever lands last wins, never a mix with duplicates.
    await Promise.all([
      browser.call(`/api/k/${created.share.token}/votes`, { method: 'POST', body: JSON.stringify({ optionIds: [t1, t2] }) }),
      browser.call(`/api/k/${created.share.token}/votes`, { method: 'POST', body: JSON.stringify({ optionIds: [t2, p1] }) }),
    ]);
    const after = (await db.select().from(votes).where(eq(votes.participantId, participantId))).map((v) => v.optionId).sort();
    expect([[t1, t2].sort(), [t2, p1].sort()]).toContainEqual(after);
    const voted = await db
      .select()
      .from(planEvents)
      .where(and(eq(planEvents.participantId, participantId), eq(planEvents.type, 'voted')));
    expect(voted).toHaveLength(1);
  });
});

describe('creator actions', () => {
  it('keeps guests and other accounts away from lock, cancel, done, edit and rotate-link', async () => {
    const creator = await signedIn('creator-a');
    const created = await newPlan(creator);
    const id = created.plan.id ?? '';
    const { browser: guest } = await joinedGuest(created.share.token, 'Quân');
    const other = await signedIn('someone-else');
    const lockBody = JSON.stringify({ timeOptionId: optionIds(created, 'time')[0], placeOptionId: optionIds(created, 'place')[0] });
    for (const [path, body] of [
      ['lock', lockBody],
      ['cancel', '{}'],
      ['done', '{}'],
      ['rotate-link', '{}'],
    ] as const) {
      const byGuest = await guest.call(`/api/plans/${id}/${path}`, { method: 'POST', body });
      expect([byGuest.status, await byGuest.json()]).toEqual([401, { error: 'sign-in-required' }]);
      const byOther = await other.call(`/api/plans/${id}/${path}`, { method: 'POST', body });
      expect([byOther.status, await byOther.json()]).toEqual([403, { error: 'not-creator' }]);
    }
    const edit = await other.call(`/api/plans/${id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Hijack' }) });
    expect(edit.status).toBe(403);
    // There is no lock route on the guest side at all.
    expect((await guest.call(`/api/k/${created.share.token}/lock`, { method: 'POST', body: lockBody })).status).toBe(404);
    const [row] = await server.database.db.select().from(plans).where(eq(plans.id, id));
    expect(row).toMatchObject({ status: 'open', title: 'Cà phê thứ Bảy' });
  });

  it('locks in one transaction: two locks at once give exactly one winner, and no vote lands after it', async () => {
    const creator = await signedIn('creator-a');
    const created = await newPlan(creator);
    const id = created.plan.id ?? '';
    const [t1, t2] = optionIds(created, 'time');
    const [p1, p2] = optionIds(created, 'place');
    const { browser: guest } = await joinedGuest(created.share.token, 'Vy');

    const missing = await creator.call(`/api/plans/${id}/lock`, { method: 'POST', body: JSON.stringify({ timeOptionId: t1 }) });
    expect([missing.status, await missing.json()]).toEqual([400, { error: 'lock-choice-required' }]);
    const wrongKind = await creator.call(`/api/plans/${id}/lock`, { method: 'POST', body: JSON.stringify({ timeOptionId: p1, placeOptionId: p2 }) });
    expect([wrongKind.status, await wrongKind.json()]).toEqual([400, { error: 'invalid-option' }]);

    const [a, b] = await Promise.all([
      creator.call(`/api/plans/${id}/lock`, { method: 'POST', body: JSON.stringify({ timeOptionId: t1, placeOptionId: p1 }) }),
      creator.call(`/api/plans/${id}/lock`, { method: 'POST', body: JSON.stringify({ timeOptionId: t2, placeOptionId: p2 }) }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(await loser.json()).toEqual({ error: 'plan-not-open' });
    const winner = ((await (a.status === 200 ? a : b).json()) as PlanAnswer).plan;
    expect(winner.status).toBe('locked');
    expect([[t1, p1], [t2, p2]]).toContainEqual(winner.lockedOptionIds);
    const locks = await server.database.db
      .select()
      .from(planEvents)
      .where(and(eq(planEvents.planId, id), eq(planEvents.type, 'locked')));
    expect(locks).toHaveLength(1);

    const late = await guest.call(`/api/k/${created.share.token}/votes`, { method: 'POST', body: JSON.stringify({ optionIds: [t1] }) });
    expect([late.status, await late.json()]).toEqual([409, { error: 'plan-not-open' }]);
    // Saying who goes still works after the lock.
    expect((await guest.call(`/api/k/${created.share.token}/rsvp`, { method: 'POST', body: JSON.stringify({ rsvp: 'going' }) })).status).toBe(200);

    const done = await creator.call(`/api/plans/${id}/done`, { method: 'POST', body: '{}' });
    expect(((await done.json()) as PlanAnswer).plan.status).toBe('done');
    const cancel = await creator.call(`/api/plans/${id}/cancel`, { method: 'POST', body: '{}' });
    expect([cancel.status, await cancel.json()]).toEqual([409, { error: 'plan-closed' }]);
    const join = await new Browser(server).call(`/api/k/${created.share.token}/join`, { method: 'POST', body: JSON.stringify({ displayName: 'Late' }) });
    expect([join.status, await join.json()]).toEqual([409, { error: 'plan-closed' }]);
  });

  it('refuses votes after the deadline but still lets the creator lock in', async () => {
    const creator = await signedIn('creator-a');
    const created = await newPlan(creator, { voteDeadline: new Date(clock + HOUR).toISOString() });
    const { browser: guest } = await joinedGuest(created.share.token, 'Hà');
    const saved = clock;
    clock += 2 * HOUR;
    try {
      const late = await guest.call(`/api/k/${created.share.token}/votes`, { method: 'POST', body: JSON.stringify({ optionIds: optionIds(created, 'time') }) });
      expect([late.status, await late.json()]).toEqual([409, { error: 'deadline-passed' }]);
      const view = ((await (await guest.call(`/api/k/${created.share.token}`)).json()) as PlanAnswer).plan;
      expect(view.can).toMatchObject({ vote: false, join: true });
      const lock = await creator.call(`/api/plans/${created.plan.id ?? ''}/lock`, {
        method: 'POST',
        body: JSON.stringify({ timeOptionId: optionIds(created, 'time')[0], placeOptionId: optionIds(created, 'place')[0] }),
      });
      expect(lock.status).toBe(200);
    } finally {
      clock = saved;
    }
  });

  it('clears the votes of an edited option and logs it, keeps the others, and handles added and removed options', async () => {
    const creator = await signedIn('creator-a');
    const created = await newPlan(creator);
    const id = created.plan.id ?? '';
    const [t1, t2] = optionIds(created, 'time');
    const [p1, p2] = optionIds(created, 'place');
    const { browser: guest, participantId } = await joinedGuest(created.share.token, 'Tú');
    await guest.call(`/api/k/${created.share.token}/votes`, { method: 'POST', body: JSON.stringify({ optionIds: [t1, t2, p1, p2] }) });

    const startsAt = (optionId: string | undefined): string => created.plan.options.find((o) => o.id === optionId)?.startsAt ?? '';
    const options = [
      { id: t1, kind: 'time', startsAt: startsAt(t1) },
      { id: t2, kind: 'time', startsAt: new Date(clock + 50 * HOUR).toISOString() },
      { id: p1, kind: 'place', label: 'Quán cà phê A' },
      { kind: 'place', label: 'Quán cà phê C' },
    ];
    const res = await creator.call(`/api/plans/${id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Cà phê Chủ nhật', options }) });
    expect(res.status).toBe(200);
    const plan = ((await res.json()) as PlanAnswer).plan;
    expect(plan.title).toBe('Cà phê Chủ nhật');
    expect(plan.options.map((o) => o.label)).toEqual(['', '', 'Quán cà phê A', 'Quán cà phê C']);
    const mine = plan.participants.find((p) => p.id === participantId);
    expect(mine?.optionIds.sort()).toEqual([t1, p1].sort());

    const events = await server.database.db.select().from(planEvents).where(eq(planEvents.planId, id));
    const types = events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['plan_edited', 'option_edited', 'option_removed', 'option_added']));
    expect(events.find((e) => e.type === 'option_edited')?.payload).toEqual({ optionId: t2, clearedVotes: 1 });

    const badKind = await creator.call(`/api/plans/${id}`, { method: 'PATCH', body: JSON.stringify({ options: [{ id: t1, kind: 'place', label: 'X' }] }) });
    expect([badKind.status, await badKind.json()]).toEqual([400, { error: 'invalid-option' }]);
    const foreign = await creator.call(`/api/plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ options: [{ id: '00000000-0000-4000-8000-000000000000', kind: 'place', label: 'X' }] }),
    });
    expect(foreign.status).toBe(400);
  });

  it('rotates the share link: the old one is a 404 at once, guests keep who they are', async () => {
    const creator = await signedIn('creator-a');
    const created = await newPlan(creator);
    const { browser: guest, participantId } = await joinedGuest(created.share.token, 'Nam');
    const rotated = await creator.call(`/api/plans/${created.plan.id ?? ''}/rotate-link`, { method: 'POST', body: '{}' });
    const { share } = (await rotated.json()) as Pick<CreatedPlan, 'share'>;
    expect(share.token).not.toBe(created.share.token);
    expect(share.url).toBe(`${server.origin}/k/${share.token}`);
    const old = await guest.call(`/api/k/${created.share.token}`);
    expect([old.status, await old.text()]).toEqual([404, '{"error":"not-found"}']);
    const fresh = ((await (await guest.call(`/api/k/${share.token}`)).json()) as PlanAnswer).plan;
    expect(fresh.viewer.participantId).toBe(participantId);
  });

  it('recognises the signed-in creator on the plan page by account, without a guest cookie', async () => {
    const creator = await signedIn('creator-page');
    const created = await newPlan(creator);
    const res = await creator.call(`/api/k/${created.share.token}`);
    expect(res.headers.getSetCookie()).toEqual([]);
    const view = ((await res.json()) as PlanAnswer).plan;
    expect(view).toMatchObject({ id: created.plan.id, viewer: { isCreator: true, participantId: null }, creatorName: null });
    expect(view.can).toMatchObject({ lock: true, cancel: true, rotateLink: true, edit: true, done: false });
    const join = await creator.call(`/api/k/${created.share.token}/join`, { method: 'POST', body: JSON.stringify({ displayName: 'Minh' }) });
    const joined = ((await join.json()) as PlanAnswer).plan;
    expect(joined.creatorName).toBe('Minh');
    expect(joined.participants).toEqual([expect.objectContaining({ displayName: 'Minh', isCreator: true })]);
    const voted = await creator.call(`/api/k/${created.share.token}/votes`, { method: 'POST', body: JSON.stringify({ optionIds: optionIds(created, 'time') }) });
    expect(voted.status).toBe(200);
  });
});

describe('rate limits', () => {
  let limited: TestServer;
  let limitedIdp: FakeIdp;
  beforeAll(async () => {
    limitedIdp = await startFakeIdp({ clientId: CLIENT_ID, clientSecret: SECRET, sub: 'creator-limited' });
    limited = await startTestServer(
      { AUTH_ISSUER: limitedIdp.issuer, AUTH_CLIENT_SECRET: SECRET },
      { planCreateLimitPerHour: 3, joinLimitPerHour: 2, voteLimitPerHour: 2, rsvpLimitPerHour: 2, guestActionLimitPerHourPerIp: 12, linkOpenCountLimitPerHour: 2 },
    );
  });
  afterAll(async () => {
    await limited.close();
    await limitedIdp.close();
  });

  it('limits plans per account; joins, votes and answers per IP and plan under a per-IP ceiling; counts opens per IP', async () => {
    const creator = new Browser(limited);
    creator.add(await signIn(limited));
    const body = JSON.stringify(planBody(Date.now()));
    const made = [
      await creator.call('/api/plans', { method: 'POST', body }),
      await creator.call('/api/plans', { method: 'POST', body }),
      await creator.call('/api/plans', { method: 'POST', body }),
    ];
    expect(made.map((r) => r.status)).toEqual([201, 201, 201]);
    const over = await creator.call('/api/plans', { method: 'POST', body });
    expect([over.status, await over.json()]).toEqual([429, { error: 'rate-limited' }]);
    // Another account still can.
    limitedIdp.setSub('creator-limited-2');
    const second = new Browser(limited);
    second.add(await signIn(limited));
    expect((await second.call('/api/plans', { method: 'POST', body })).status).toBe(201);

    const [first, other, third] = await Promise.all(made.map(async (r) => ((await r.json()) as CreatedPlan).share.token));
    const guest = new Browser(limited);
    const post = (token: string | undefined, action: string, payload: unknown): Promise<number> =>
      guest.call(`/api/k/${token ?? ''}/${action}`, { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.status);
    const join = (token: string | undefined): Promise<number> => post(token, 'join', { displayName: 'A' });
    const vote = (token: string | undefined): Promise<number> => post(token, 'votes', { optionIds: [] });
    const rsvp = (token: string | undefined): Promise<number> => post(token, 'rsvp', { rsvp: 'going' });
    expect([await join(first), await join(first), await join(first)]).toEqual([200, 200, 429]);
    // Votes and answers have counters of their own.
    expect([await vote(first), await vote(first), await vote(first)]).toEqual([200, 200, 429]);
    expect([await rsvp(first), await rsvp(first), await rsvp(first)]).toEqual([200, 200, 429]);
    // Another plan from the same address has its own counts, until the per-IP ceiling (12 per hour here, refused requests included).
    expect([await join(other), await vote(other), await rsvp(other)]).toEqual([200, 200, 200]);
    expect(await join(third)).toBe(429);

    // Opens are served past the hourly count of the address, but not counted.
    const opens = await Promise.all([1, 2, 3, 4].map((n) => api(limited, `/api/k/${third ?? ''}`, { headers: { 'user-agent': `browser ${n}` } })));
    expect(opens.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const [plan] = await limited.database.db.select().from(plans).where(eq(plans.shareTokenHash, hashToken(third ?? '')));
    const opened = await limited.database.db.select().from(planEvents).where(and(eq(planEvents.planId, plan?.id ?? ''), eq(planEvents.type, 'link_opened')));
    expect(opened).toHaveLength(2);
  });
});
