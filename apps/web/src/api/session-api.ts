import { useEffect, useState } from 'react';
import * as z from 'zod/mini';
import { apiFetch } from './api-client';

/** The signed-in account as the IdP named it at the latest sign-in; any field may be null. */
const SessionUserSchema = z.object({ name: z.nullable(z.string()), email: z.nullable(z.string()), picture: z.nullable(z.string()) });
export type SessionUser = z.infer<typeof SessionUserSchema>;

const SessionSchema = z.object({ signedIn: z.boolean(), signInAvailable: z.boolean(), user: z.optional(SessionUserSchema) });
export type SessionInfo = z.infer<typeof SessionSchema>;

export type SessionState = { status: 'loading' } | ({ status: 'ready' } & SessionInfo);

export async function fetchSession(): Promise<SessionInfo> {
  return SessionSchema.parse(await (await apiFetch('/api/session')).json());
}

export async function signOut(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' });
}

/** The app's sign-in page (a sign-in card for a link or bookmark that opens it). */
export const LOGIN_PATH = '/login';

/** Stands in for the site's origin when resolving a return path: only "is it still this origin" matters. */
const RETURN_BASE = 'https://return.invalid';
/** A control character (tab, newline…): browsers strip them from a URL, so "/\t/evil.com" would become "//evil.com". */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * The paths sign-in may come back to: this site only, by the same rule as the server (apps/server oidc-login.ts):
 * starts with "/", no control character or backslash, resolves to this origin; the resolved path, query and fragment.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length > 200 || !value.startsWith('/') || value.includes('\\') || hasControlChar(value)) return '/';
  let url: URL;
  try {
    url = new URL(value, RETURN_BASE);
  } catch {
    return '/';
  }
  // The sign-in page itself would only show the card again.
  if (url.origin !== RETURN_BASE || url.pathname === LOGIN_PATH) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Where the sign-in page sends the visitor back to (its `?return=`), home by default. */
export function loginReturnPath(search: string): string {
  return safeReturnPath(new URLSearchParams(search).get('return'));
}

function authLoginHref(locale: string, returnTo: string, signUp: boolean): string {
  const query = new URLSearchParams({ return: safeReturnPath(returnTo), lang: locale });
  if (signUp) query.set('signup', '1');
  return `/auth/login?${query.toString()}`;
}

/** The server's sign-in route: to the IdP in `locale`, then back to `returnTo`. For "Đăng nhập" links. */
export function signInHref(locale: string, returnTo: string): string {
  return authLoginHref(locale, returnTo, false);
}

/**
 * The same route for a sign-up button ("Đăng ký…"): the IdP opens on making an account (`prompt=create`, which
 * links to sign-in for people who have one). Only sign-up buttons use it: the IdP's log counts these as sign-ups.
 */
export function signUpHref(locale: string, returnTo: string): string {
  return authLoginHref(locale, returnTo, true);
}

/** The session, once; an unreachable API counts as signed out with sign-in unavailable. */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    fetchSession()
      .then((info) => live && setState({ status: 'ready', ...info }))
      .catch(() => live && setState({ status: 'ready', signedIn: false, signInAvailable: false }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}
