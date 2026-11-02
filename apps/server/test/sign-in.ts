/** The browser's sign-in round trip through the fake IdP, and API calls with the app's Origin, for server tests. */
import { expect } from 'vitest';
import type { TestServer } from './test-server';

/** Set-Cookie header of a response, as the `name=value` the next request sends. */
export function cookieFrom(res: Response, name: string): string {
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (!header) throw new Error(`no ${name} cookie`);
  return header.split(';')[0] ?? '';
}

export function location(res: Response): string {
  const value = res.headers.get('location');
  if (!value) throw new Error(`no redirect (status ${res.status})`);
  return value;
}

/** The whole browser round trip through the fake IdP; returns the session cookie. */
export async function signIn(server: TestServer): Promise<string> {
  const start = await fetch(`${server.origin}/auth/login?return=/saved`, { redirect: 'manual' });
  expect(start.status).toBe(302);
  const authorize = new URL(location(start));
  expect(authorize.searchParams.get('scope')).toBe('openid profile email');
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorize.searchParams.get('redirect_uri')).toBe(`${server.origin}/auth/callback`);
  // A plain sign-in never asks the IdP to open on making an account.
  expect(authorize.searchParams.get('prompt')).toBeNull();
  const loginCookie = cookieFrom(start, 'lockin_login');
  const consent = await fetch(authorize, { redirect: 'manual' });
  const callback = await fetch(location(consent), { redirect: 'manual', headers: { cookie: loginCookie } });
  expect(location(callback)).toBe('/saved');
  return cookieFrom(callback, 'lockin_session');
}

export function api(server: TestServer, path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('origin', server.origin);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body) headers.set('content-type', 'application/json');
  return fetch(`${server.origin}${path}`, { ...init, headers });
}
