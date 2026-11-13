/**
 * An account deleted at the IdP (auth-next ADR 0018, POST /api/idp/account-deleted): which notices are taken, that the
 * account, its sessions and the plans nobody else joined go, that a plan others joined passes to the earliest of them,
 * and that a repeated notice changes nothing.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FakeIdp, startFakeIdp } from '../../test/fake-idp';
import { Browser, type CreatedPlan, type PlanAnswer, planBody } from '../../test/plan-browser';
import { signIn } from '../../test/sign-in';
import { type TestServer, startTestServer } from '../../test/test-server';
import { participants, plans, sessions, users, votes } from '../db/schema';
import { ACCOUNT_DELETED_PATH } from './account-deleted';

const SECRET = 'test-secret-'.padEnd(40, 'x');

let idp: FakeIdp;
let server: TestServer;

beforeAll(async () => {
  idp = await startFakeIdp({ clientId: 'lockin-web', clientSecret: SECRET, sub: 'leaver' });
  server = await startTestServer({ AUTH_ISSUER: idp.issuer, AUTH_CLIENT_SECRET: SECRET });
});
afterAll(async () => {
  await server.close();
  await idp.close();
});

const receiver = (): string => `${server.origin}${ACCOUNT_DELETED_PATH}`;
/** The IdP's POST: server to server, no Origin, no cookie. */
const notify = (body: string, type = 'application/secevent+jwt'): Promise<Response> => fetch(receiver(), { method: 'POST', headers: { 'content-type': type }, body });
const noticeFor = (sub: string, options?: Parameters<FakeIdp['accountDeletedToken']>[2]): string => idp.accountDeletedToken(sub, receiver(), options);
const b64url = (value: string): string => Buffer.from(value).toString('base64url');

async function signedIn(sub: string): Promise<Browser> {
  idp.setSub(sub);
  const browser = new Browser(server);
  browser.add(await signIn(server));
  return browser;
}

const isSignedIn = async (browser: Browser): Promise<boolean> => ((await (await browser.call('/api/session')).json()) as { signedIn: boolean }).signedIn;

async function makePlan(browser: Browser, title: string): Promise<CreatedPlan> {
  const res = await browser.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(Date.now(), { title, creatorDisplayName: 'Người rời' })) });
  expect(res.status).toBe(201);
  return (await res.json()) as CreatedPlan;
}

async function join(browser: Browser, created: CreatedPlan, displayName: string): Promise<PlanAnswer> {
  const res = await browser.call(`/api/k/${created.share.token}/join`, { method: 'POST', body: JSON.stringify({ displayName }) });
  expect(res.status).toBe(200);
  return (await res.json()) as PlanAnswer;
}

async function vote(browser: Browser, created: CreatedPlan, optionIds: string[]): Promise<void> {
  const res = await browser.call(`/api/k/${created.share.token}/votes`, { method: 'POST', body: JSON.stringify({ optionIds }) });
  expect(res.status).toBe(200);
}

describe('POST /api/idp/account-deleted: which notices are taken', () => {
  const nowS = (): number => Math.floor(Date.now() / 1000);

  it.each([
    ['a key the IdP never published', () => noticeFor('careful', { how: 'stranger' })],
    ['another receiver', () => noticeFor('careful', { claims: { aud: 'https://chat.hoandat.com/api/idp/account-deleted' } })],
    ['an audience list', () => noticeFor('careful', { claims: { aud: [receiver()] } })],
    ['another issuer', () => noticeFor('careful', { claims: { iss: 'https://evil.example' } })],
    ['an expired notice', () => noticeFor('careful', { claims: { iat: nowS() - 1200, exp: nowS() - 600 } })],
    ['no expiry', () => noticeFor('careful', { claims: { exp: undefined } })],
    ['another event', () => noticeFor('careful', { claims: { events: { 'urn:hoandat:auth:event:account.created': {} } } })],
    ['no sub', () => noticeFor('')],
  ])('refuses %s with 401 and deletes nothing', async (_label, makeToken) => {
    const browser = await signedIn('careful');
    expect((await notify(makeToken())).status).toBe(401);
    expect(await isSignedIn(browser)).toBe(true);
  });

  it('refuses a token signed with another algorithm than ES256', async () => {
    const browser = await signedIn('careful');
    const [, payload = '', signature = ''] = noticeFor('careful').split('.');
    const forged = `${b64url(JSON.stringify({ alg: 'RS256', kid: 'fake-key-1', typ: 'secevent+jwt' }))}.${payload}.${signature}`;
    expect((await notify(forged)).status).toBe(401);
    expect(await isSignedIn(browser)).toBe(true);
  });

  it.each([
    ['an empty body', () => ''],
    ['not a JWS', () => 'hello'],
    ['another token type (a logout token)', () => noticeFor('careful', { typ: 'logout+jwt' })],
  ])('answers 400 to %s', async (_label, makeBody) => {
    expect((await notify(makeBody())).status).toBe(400);
  });

  it('answers 400 to a SET sent as another media type', async () => {
    expect((await notify(noticeFor('careful'), 'application/json')).status).toBe(400);
  });

  it('answers 202 to an account this app never saw', async () => {
    expect((await notify(noticeFor('never-signed-in'))).status).toBe(202);
  });

  it('answers 503 while sign-in is off (no IdP to check against), so the IdP retries', async () => {
    const off = await startTestServer();
    try {
      const res = await fetch(`${off.origin}${ACCOUNT_DELETED_PATH}`, { method: 'POST', headers: { 'content-type': 'application/secevent+jwt' }, body: noticeFor('careful') });
      expect(res.status).toBe(503);
    } finally {
      await off.close();
    }
  });
});

describe('POST /api/idp/account-deleted: what goes and who takes over', () => {
  it('deletes the account and its lone plans, and hands a joined plan to the guest who joined first', async () => {
    const db = server.database.db;
    const leaver = await signedIn('leaver');
    const lone = await makePlan(leaver, 'Chỉ mình tôi');
    const shared = await makePlan(leaver, 'Cả nhóm');
    const optionIds = shared.plan.options.map((o) => o.id);
    await vote(leaver, shared, optionIds);
    const first = new Browser(server);
    const second = new Browser(server);
    await join(first, shared, 'Lan');
    await vote(first, shared, [optionIds[0] ?? '']);
    await join(second, shared, 'Huy');
    const other = await signedIn('stays');
    const othersPlan = await makePlan(other, 'Kèo người khác');
    const [account] = await db.select({ id: users.id }).from(users).where(eq(users.sub, 'leaver'));
    const leaverRow = shared.plan.participants.find((p) => p.isCreator);

    expect((await notify(noticeFor('leaver'))).status).toBe(202);

    // The account and every session of it.
    expect(await db.select().from(users).where(eq(users.sub, 'leaver'))).toEqual([]);
    expect(await db.select().from(sessions).where(eq(sessions.userId, account?.id ?? ''))).toEqual([]);
    expect(await isSignedIn(leaver)).toBe(false);
    // The plan nobody joined is gone; nothing is left owned by the deleted account.
    expect(await db.select().from(plans).where(eq(plans.id, lone.plan.id ?? ''))).toEqual([]);
    expect(await db.select().from(plans).where(eq(plans.creatorSub, 'leaver'))).toEqual([]);

    // The joined plan stays, led by Lan; the leaver's row and ballots are gone, the others' stay.
    const rows = await db.select().from(participants).where(eq(participants.planId, shared.plan.id ?? ''));
    expect(rows.map((r) => [r.displayName, r.isCreator]).sort()).toEqual([
      ['Huy', false],
      ['Lan', true],
    ]);
    expect(await db.select().from(votes).where(eq(votes.participantId, leaverRow?.id ?? ''))).toEqual([]);
    expect(await db.select().from(votes).where(eq(votes.planId, shared.plan.id ?? ''))).toHaveLength(1);
    const [handed] = await db.select().from(plans).where(eq(plans.id, shared.plan.id ?? ''));
    expect(handed).toMatchObject({ creatorSub: null, manageTokenEnc: null });

    // Lan's browser opens the link as the creator: the guest cookie becomes the creator cookie, and she can manage it.
    const planId = shared.plan.id ?? '';
    const cookieId = planId.replaceAll('-', '');
    const guestToken = first.cookie(`lockin_g_${cookieId}`);
    expect(guestToken).toBeDefined();
    const opened = (await (await first.call(`/api/k/${shared.share.token}`)).json()) as PlanAnswer;
    expect(opened.plan).toMatchObject({ creatorName: 'Lan', savedToAccount: false, viewer: { isCreator: true } });
    // Her manage link is back, made of her own token; the leaver's old one opens nothing.
    expect(opened.plan.manage?.url).toBe(`${server.origin}/m/${planId}.${guestToken ?? ''}`);
    expect(first.cookie(`lockin_g_${cookieId}`)).toBeUndefined();
    expect(first.cookie(`lockin_c_${cookieId}`)).toBe(guestToken);
    const rotated = await first.call(`/api/plans/${planId}/rotate-manage`, { method: 'POST' });
    expect(rotated.status).toBe(200);
    // Huy is still a guest of it, and sees Lan lead.
    const seen = (await (await second.call(`/api/k/${shared.share.token}`)).json()) as PlanAnswer;
    expect(seen.plan).toMatchObject({ creatorName: 'Lan', viewer: { isCreator: false } });

    // Another account's plan and session are untouched.
    expect(await db.select({ id: plans.id }).from(plans).where(eq(plans.id, othersPlan.plan.id ?? ''))).toHaveLength(1);
    expect(await isSignedIn(other)).toBe(true);
  });

  it('takes the same notice again (the IdP retries) without changing anything', async () => {
    const twice = await signedIn('twice');
    await makePlan(twice, 'Một lần');
    const notice = noticeFor('twice');
    expect((await notify(notice)).status).toBe(202);
    expect((await notify(notice)).status).toBe(202);
    expect(await server.database.db.select().from(users).where(eq(users.sub, 'twice'))).toEqual([]);
  });
});
