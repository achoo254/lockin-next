import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plans } from '../db/schema';
import { type FakeIdp, startFakeIdp } from '../../test/fake-idp';
import { Browser, type CreatedPlan, type PlanAnswer, planBody } from '../../test/plan-browser';
import { signIn } from '../../test/sign-in';
import { type TestServer, startTestServer } from '../../test/test-server';
import { shareTokenBox } from './share-token-box';
import { newToken } from './tokens';

const CLIENT_ID = 'lockin-web';
const SECRET = 'test-secret-'.padEnd(40, 'x');

describe('the share token box', () => {
  const box = shareTokenBox(randomBytes(32));
  const planId = randomUUID();
  const token = newToken();

  it('opens what it sealed for the same plan, never the plain token in the sealed text', () => {
    const sealed = box.seal(token, planId);
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain(token);
    expect(box.open(sealed, planId)).toBe(token);
    // A fresh IV each time.
    expect(box.seal(token, planId)).not.toBe(sealed);
  });

  it('opens nothing for another plan, another key, a changed value or junk', () => {
    const sealed = box.seal(token, planId);
    expect(box.open(sealed, randomUUID())).toBeNull();
    expect(shareTokenBox(randomBytes(32)).open(sealed, planId)).toBeNull();
    const [version, iv, ciphertext, tag] = sealed.split('.');
    const flipped = `${ciphertext?.[0] === 'A' ? 'B' : 'A'}${ciphertext?.slice(1) ?? ''}`;
    expect(box.open([version, iv, flipped, tag].join('.'), planId)).toBeNull();
    for (const junk of [null, '', 'v1', 'v2.a.b.c', `${sealed}.extra`, 'v1.%%%.b.c']) expect(box.open(junk, planId)).toBeNull();
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => shareTokenBox(randomBytes(16))).toThrow(/32 bytes/);
  });
});

describe('the creator sees the share link again', () => {
  let idp: FakeIdp;
  let server: TestServer;

  beforeAll(async () => {
    idp = await startFakeIdp({ clientId: CLIENT_ID, clientSecret: SECRET, sub: 'creator-share' });
    server = await startTestServer({ AUTH_ISSUER: idp.issuer, AUTH_CLIENT_SECRET: SECRET });
  });
  afterAll(async () => {
    await server.close();
    await idp.close();
  });

  async function creatorWithPlan(): Promise<{ creator: Browser; created: CreatedPlan; id: string }> {
    const creator = new Browser(server);
    creator.add(await signIn(server));
    const res = await creator.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(Date.now(), { creatorDisplayName: 'Minh' })) });
    expect(res.status).toBe(201);
    const created = (await res.json()) as CreatedPlan;
    return { creator, created, id: created.plan.id ?? '' };
  }

  it('stores the token sealed beside its hash, and returns the link on the plan, the list and the plan page', async () => {
    const { creator, created, id } = await creatorWithPlan();
    expect(created.plan.share).toEqual(created.share);
    const [row] = await server.database.db.select().from(plans).where(eq(plans.id, id));
    expect(row?.shareTokenEnc).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain(created.share.token);
    expect(shareTokenBox(server.config.shareTokenKey).open(row?.shareTokenEnc ?? null, id)).toBe(created.share.token);

    const one = ((await (await creator.call(`/api/plans/${id}`)).json()) as PlanAnswer).plan;
    expect(one.share).toEqual(created.share);
    const list = (await (await creator.call('/api/plans')).json()) as { plans: Array<Record<string, unknown>> };
    const item = list.plans.find((plan) => plan.id === id);
    expect(item?.shareUrl).toBe(created.share.url);
    expect(Object.keys(item ?? {})).not.toContain('shareTokenEnc');
    const page = ((await (await creator.call(`/api/k/${created.share.token}`)).json()) as PlanAnswer).plan;
    expect(page.share).toEqual(created.share);
  });

  it('never gives the link, the sealed token or the plan id to a guest', async () => {
    const { created } = await creatorWithPlan();
    const guest = new Browser(server);
    const answers = [
      await guest.call(`/api/k/${created.share.token}`),
      await guest.call(`/api/k/${created.share.token}/join`, { method: 'POST', body: JSON.stringify({ displayName: 'Linh' }) }),
      await guest.call(`/api/k/${created.share.token}/rsvp`, { method: 'POST', body: JSON.stringify({ rsvp: 'going' }) }),
    ];
    for (const res of answers) {
      expect(res.status).toBe(200);
      const text = await res.text();
      const { plan } = JSON.parse(text) as PlanAnswer;
      expect(plan).not.toHaveProperty('share');
      expect(plan).not.toHaveProperty('id');
      expect(text).not.toContain('v1.');
      expect(text).not.toContain(created.share.token);
    }
  });

  it('re-seals on rotate: the plan shows the new link and the old one stops working', async () => {
    const { creator, created, id } = await creatorWithPlan();
    const rotated = (await (await creator.call(`/api/plans/${id}/rotate-link`, { method: 'POST', body: '{}' })).json()) as Pick<CreatedPlan, 'share'>;
    expect(rotated.share.token).not.toBe(created.share.token);
    const one = ((await (await creator.call(`/api/plans/${id}`)).json()) as PlanAnswer).plan;
    expect(one.share).toEqual(rotated.share);
    expect((await new Browser(server).call(`/api/k/${created.share.token}`)).status).toBe(404);
    expect((await new Browser(server).call(`/api/k/${rotated.share.token}`)).status).toBe(200);
  });

  it('shows no link for a plan whose token was never kept or does not open with this key (rotate makes a new one)', async () => {
    const { creator, id } = await creatorWithPlan();
    await server.database.db.update(plans).set({ shareTokenEnc: null }).where(eq(plans.id, id));
    expect(((await (await creator.call(`/api/plans/${id}`)).json()) as PlanAnswer).plan.share).toBeNull();
    const list = (await (await creator.call('/api/plans')).json()) as { plans: Array<{ id: string; shareUrl: string | null }> };
    expect(list.plans.find((plan) => plan.id === id)?.shareUrl).toBeNull();

    await server.database.db
      .update(plans)
      .set({ shareTokenEnc: shareTokenBox(randomBytes(32)).seal(newToken(), id) })
      .where(eq(plans.id, id));
    expect(((await (await creator.call(`/api/plans/${id}`)).json()) as PlanAnswer).plan.share).toBeNull();
    const rotated = await creator.call(`/api/plans/${id}/rotate-link`, { method: 'POST', body: '{}' });
    const { share } = (await rotated.json()) as Pick<CreatedPlan, 'share'>;
    expect(((await (await creator.call(`/api/plans/${id}`)).json()) as PlanAnswer).plan.share).toEqual(share);
  });
});
