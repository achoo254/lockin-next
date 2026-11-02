import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadLockinBrand, renderIndexHtml } from '../../../web/vite-brand';
import { type FakeIdp, startFakeIdp } from '../../test/fake-idp';
import { Browser, type CreatedPlan, planBody } from '../../test/plan-browser';
import { signIn } from '../../test/sign-in';
import { type TestServer, startTestServer } from '../../test/test-server';
import { PAGE_CSP, escapeHtml, renderPlanPage } from './og-page';

const CLIENT_ID = 'lockin-web';
const SECRET = 'test-secret-'.padEnd(40, 'x');
/** A title that would break out of an attribute or open a tag if it were not escaped. */
const TRICKY_TITLE = `Cà phê "T7" <script>alert('x')</script> & co`;

/** The real page head: apps/web/index.html with the brand tags of the build. */
const TEMPLATE = renderIndexHtml(readFileSync(new URL('../../../web/index.html', import.meta.url), 'utf8'), loadLockinBrand());

const metaContent = (html: string, attr: 'property' | 'name', key: string): string[] =>
  [...html.matchAll(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`, 'g'))].map((m) => m[1] ?? '');

let idp: FakeIdp;
let server: TestServer;
let templateFails = false;

beforeAll(async () => {
  idp = await startFakeIdp({ clientId: CLIENT_ID, clientSecret: SECRET, sub: 'creator-og' });
  server = await startTestServer({ AUTH_ISSUER: idp.issuer, AUTH_CLIENT_SECRET: SECRET }, {}, () => new Date(), async () => {
    if (templateFails) throw new Error('ENOENT: no index.html');
    return TEMPLATE;
  });
});
afterAll(async () => {
  await server.close();
  await idp.close();
});

async function planWithGuest(title: string): Promise<CreatedPlan> {
  const creator = new Browser(server);
  creator.add(await signIn(server));
  const res = await creator.call('/api/plans', { method: 'POST', body: JSON.stringify(planBody(Date.now(), { title, creatorDisplayName: 'Người Tạo Bí Mật' })) });
  const created = (await res.json()) as CreatedPlan;
  const guest = new Browser(server);
  await guest.call(`/api/k/${created.share.token}`);
  await guest.call(`/api/k/${created.share.token}/join`, { method: 'POST', body: JSON.stringify({ displayName: 'Khách <b>Linh</b>' }) });
  return created;
}

describe('the plan link page', () => {
  it("puts the plan's title in the preview tags, escaped, and nothing about the people in it", async () => {
    const created = await planWithGuest(TRICKY_TITLE);
    const res = await fetch(`${server.origin}/k/${created.share.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    const html = await res.text();
    const title = `${escapeHtml(TRICKY_TITLE)} · vote trên Lockin`;
    expect(metaContent(html, 'property', 'og:title')).toEqual([title]);
    expect(metaContent(html, 'property', 'og:description')).toEqual(['Vote giờ và chỗ trên Lockin · không cần tài khoản']);
    expect(metaContent(html, 'property', 'og:url')).toEqual([created.share.url]);
    expect(metaContent(html, 'property', 'og:image')).toEqual([`https://lockin.hoandat.com/og-image.png`]);
    expect(metaContent(html, 'name', 'twitter:card')).toEqual(['summary_large_image']);
    expect(metaContent(html, 'name', 'robots')).toEqual(['noindex']);
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(`<link rel="canonical" href="${created.share.url}" />`);
    // Escaped: no raw tag or quote from the title made it into the page.
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('"T7"');
    // Never the names of the people in the plan; the token only in the link that was opened.
    expect(html).not.toContain('Linh');
    expect(html).not.toContain('Bí Mật');
    expect(html.split(created.share.token).length - 1).toBe(2);
    // The page itself is the web app.
    expect(html).toContain('<div id="root"></div>');
  });

  it('describes the plan in English for an English link', async () => {
    const created = await planWithGuest('Weekend coffee');
    const html = await (await fetch(`${server.origin}/k/${created.share.token}?lang=en`)).text();
    expect(metaContent(html, 'property', 'og:title')).toEqual(['Weekend coffee · vote on Lockin']);
    expect(metaContent(html, 'property', 'og:description')).toEqual(['Vote on the time and place on Lockin · no account needed']);
  });

  it('answers a wrong, malformed or rotated link with the same generic page, telling nothing', async () => {
    const created = await planWithGuest('Ăn tối');
    const creator = new Browser(server);
    creator.add(await signIn(server));
    await creator.call(`/api/plans/${created.plan.id ?? ''}/rotate-link`, { method: 'POST', body: '{}' });
    const pages = await Promise.all(
      [created.share.token, 'A'.repeat(43), 'short', '%3Cscript%3E'].map(async (token) => {
        const res = await fetch(`${server.origin}/k/${token}`);
        return { status: res.status, cookies: res.headers.getSetCookie(), html: await res.text() };
      }),
    );
    for (const page of pages) {
      expect(page.status).toBe(200);
      expect(page.cookies).toEqual([]);
      expect(page.html).toBe(renderPlanPage(TEMPLATE, null));
    }
    expect(metaContent(pages[0]?.html ?? '', 'property', 'og:title')).toEqual(['Lockin · chốt kèo với bạn bè hay đồng nghiệp']);
  });

  it('is never cached or indexed, hands out no guest cookie, and sends the site CSP in production only', async () => {
    const created = await planWithGuest('Karaoke');
    const res = await fetch(`${server.origin}/k/${created.share.token}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(res.headers.get('content-security-policy')).toBeNull();
    const nginx = readFileSync(new URL('../../../../infra/nginx/lockin.hoandat.com.conf', import.meta.url), 'utf8');
    expect(nginx).toContain(`add_header Content-Security-Policy "${PAGE_CSP}" always;`);
  });

  it('says so when the page template cannot be read', async () => {
    templateFails = true;
    try {
      const res = await fetch(`${server.origin}/k/${'B'.repeat(43)}`);
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
    } finally {
      templateFails = false;
    }
  });
});

describe('renderPlanPage', () => {
  it('replaces each tag once and adds the missing ones before </head>', () => {
    const html = renderPlanPage('<html><head><title>x</title></head><body></body></html>', { title: 'A & B', description: 'd', url: 'https://x/k/t' });
    expect(metaContent(html, 'property', 'og:title')).toEqual(['A &amp; B']);
    expect(metaContent(html, 'name', 'twitter:card')).toEqual(['summary_large_image']);
    expect(html.indexOf('og:url')).toBeLessThan(html.indexOf('</head>'));
    expect(html).toContain('<title>A &amp; B</title>');
  });
});
