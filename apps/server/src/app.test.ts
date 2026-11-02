import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type FakeIdp, startFakeIdp } from '../test/fake-idp';
import { api, cookieFrom, location, signIn } from '../test/sign-in';
import { type TestServer, startTestServer } from '../test/test-server';

const CLIENT_ID = 'lockin-web';
const SECRET = 'test-secret-'.padEnd(40, 'x');
const PROFILE_A = { name: 'Nguyễn Văn A', email: 'a@example.com', picture: 'https://lh3.googleusercontent.com/a/photo', telegram_linked: false };

describe('without sign-in configured', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it('answers the health check', async () => {
    const res = await fetch(`${server.origin}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('reports sign-in as unavailable and sends /auth/login back with a notice', async () => {
    expect(await (await fetch(`${server.origin}/api/session`)).json()).toEqual({ signedIn: false, signInAvailable: false });
    const res = await fetch(`${server.origin}/auth/login?return=/`, { redirect: 'manual' });
    expect(location(res)).toBe('/?login=unavailable');
  });

  it('answers unknown API paths with a JSON 404', async () => {
    const res = await fetch(`${server.origin}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
  });
});

describe('signed in through the hoandat.com account', () => {
  let idp: FakeIdp;
  let server: TestServer;

  beforeAll(async () => {
    idp = await startFakeIdp({ clientId: CLIENT_ID, clientSecret: SECRET, sub: 'account-a', profile: PROFILE_A });
    server = await startTestServer({ AUTH_ISSUER: idp.issuer, AUTH_CLIENT_SECRET: SECRET });
  });
  afterAll(async () => {
    await server.close();
    await idp.close();
  });

  it('opens a session from Code + PKCE and ends it on logout', async () => {
    const session = await signIn(server);
    expect(session).toMatch(/^lockin_session=[A-Za-z0-9_-]{43}$/);
    expect(await (await api(server, '/api/session', { cookie: session })).json()).toEqual({
      signedIn: true,
      signInAvailable: true,
      user: { name: 'Nguyễn Văn A', email: 'a@example.com', picture: 'https://lh3.googleusercontent.com/a/photo' },
    });
    const logout = await api(server, '/auth/logout', { method: 'POST', cookie: session });
    expect(logout.status).toBe(204);
    expect(await (await api(server, '/api/session', { cookie: session })).json()).toMatchObject({ signedIn: false });
  });

  it('keeps the name, email and picture of the latest sign-in, and the stored ones when userinfo fails', async () => {
    const session = (cookie: string): Promise<unknown> => api(server, '/api/session', { cookie }).then((res) => res.json());
    idp.setSub('account-profile');
    try {
      // No picture and no name at the IdP: the username stands in, the picture is cleared.
      idp.setProfile({ preferred_username: 'van-b', email: 'b@example.com', picture: 'http://insecure.example/b.png' });
      expect(await session(await signIn(server))).toMatchObject({ user: { name: 'van-b', email: 'b@example.com', picture: null } });
      idp.setProfile({ name: 'Văn B', email: 'b@example.com', picture: 'https://avatars.githubusercontent.com/u/1' });
      const second = await signIn(server);
      expect(await session(second)).toMatchObject({ user: { name: 'Văn B', picture: 'https://avatars.githubusercontent.com/u/1' } });
      // Userinfo down: sign-in still works, the profile stays as it was.
      idp.failUserinfo(true);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        expect(await session(await signIn(server))).toMatchObject({ user: { name: 'Văn B', email: 'b@example.com' } });
        expect(warn).toHaveBeenCalledWith('userinfo not used', 500);
      } finally {
        warn.mockRestore();
      }
    } finally {
      idp.failUserinfo(false);
      idp.setProfile(PROFILE_A);
      idp.setSub('account-a');
    }
  });

  it('opens the IdP on making an account when a sign-up button sent the person, and still comes back', async () => {
    const start = await fetch(`${server.origin}/auth/login?return=/saved&lang=en&signup=1`, { redirect: 'manual' });
    const authorize = new URL(location(start));
    expect(authorize.searchParams.get('prompt')).toBe('create');
    expect(authorize.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(authorize.searchParams.get('ui_locales')).toBe('en');
    // Any other value is a plain sign-in.
    const other = new URL(location(await fetch(`${server.origin}/auth/login?signup=yes`, { redirect: 'manual' })));
    expect(other.searchParams.get('prompt')).toBeNull();
    const consent = await fetch(authorize, { redirect: 'manual' });
    const callback = await fetch(location(consent), { redirect: 'manual', headers: { cookie: cookieFrom(start, 'lockin_login') } });
    expect(location(callback)).toBe('/saved');
  });

  it('rejects a callback without the login cookie or with another state', async () => {
    const start = await fetch(`${server.origin}/auth/login`, { redirect: 'manual' });
    const consent = await fetch(location(start), { redirect: 'manual' });
    const noCookie = await fetch(location(consent), { redirect: 'manual' });
    expect(location(noCookie)).toBe('/?login=fail');
    expect(noCookie.headers.getSetCookie().some((c) => c.startsWith('lockin_session='))).toBe(false);

    const again = await fetch(`${server.origin}/auth/login`, { redirect: 'manual' });
    const wrongState = new URL(location(await fetch(location(again), { redirect: 'manual' })));
    wrongState.searchParams.set('state', 'forged');
    const forged = await fetch(wrongState, { redirect: 'manual', headers: { cookie: cookieFrom(again, 'lockin_login') } });
    expect(location(forged)).toBe('/?login=fail');
  });

  it('refuses state changes from another origin (CSRF)', async () => {
    const session = await signIn(server);
    const crossSite = await fetch(`${server.origin}/auth/logout`, { method: 'POST', headers: { cookie: session, origin: 'https://evil.example' } });
    expect(crossSite.status).toBe(403);
    const noOrigin = await fetch(`${server.origin}/auth/logout`, { method: 'POST', headers: { cookie: session } });
    expect(noOrigin.status).toBe(403);
    // The session survived both attempts.
    expect(await (await api(server, '/api/session', { cookie: session })).json()).toMatchObject({ signedIn: true });
  });

  it('answers a malformed JSON body with a JSON 400', async () => {
    const res = await api(server, '/auth/logout', { method: 'POST', body: '{' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-body' });
  });
});

describe('sign-in limits and session hygiene', () => {
  let idp: FakeIdp;
  let server: TestServer;

  beforeAll(async () => {
    idp = await startFakeIdp({ clientId: CLIENT_ID, clientSecret: SECRET, sub: 'account-c' });
    server = await startTestServer({ AUTH_ISSUER: idp.issuer, AUTH_CLIENT_SECRET: SECRET }, { signInLimitPer15Min: 3 });
  });
  afterAll(async () => {
    await server.close();
    await idp.close();
  });

  it('replaces the browser’s previous session when it signs in again', async () => {
    const first = await signIn(server);
    const start = await fetch(`${server.origin}/auth/login?return=/saved`, { redirect: 'manual' });
    const consent = await fetch(location(start), { redirect: 'manual' });
    const callback = await fetch(location(consent), { redirect: 'manual', headers: { cookie: `${cookieFrom(start, 'lockin_login')}; ${first}` } });
    const second = cookieFrom(callback, 'lockin_session');
    expect(second).not.toBe(first);
    expect(await (await api(server, '/api/session', { cookie: first })).json()).toMatchObject({ signedIn: false });
    expect(await (await api(server, '/api/session', { cookie: second })).json()).toMatchObject({ signedIn: true });
  });

  it('sends a start over the limit back to the page with a notice, not a bare 429', async () => {
    // Two starts were used above (limit 3 per window).
    expect((await fetch(`${server.origin}/auth/login?return=/`, { redirect: 'manual' })).status).toBe(302);
    const over = await fetch(`${server.origin}/auth/login?return=/credits`, { redirect: 'manual' });
    expect(over.status).toBe(302);
    expect(location(over)).toBe('/credits?login=busy');
  });
});
