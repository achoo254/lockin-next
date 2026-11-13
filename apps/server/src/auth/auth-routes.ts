/**
 * Sign-in with a hoandat.com account (BFF): /auth/login sends the browser to auth-next (Code + PKCE, scope
 * `openid profile email`), /auth/callback exchanges the code server-side with client_secret_basic, reads the
 * account's name, email and picture from userinfo with the access token (then drops the token) and opens the
 * app's own session; POST /auth/logout ends it. GET /api/session tells the web app whether it is signed in, and
 * as whom (the header's account menu).
 */
import express, { type Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AuthConfig, ServerConfig } from '../config';
import type { Db } from '../db/client';
import { codeChallenge, newLoginState, openState, profileFromUserinfo, safeReturnPath, sealState, subFromIdToken } from './oidc-login';
import { clearSessionCookie, readCookie, readSessionToken, setSessionCookie } from './session-cookie';
import { safeErrorText } from '../log-error';
import { findOwnedPlanIds } from '../plans/plan-store';
import { clearPlanCookie, listPlanCookies } from '../plans/tokens';
import {
  type AccountProfile,
  createSession,
  deleteSessionByToken,
  findProfile,
  findSession,
  purgeExpiredSessions,
  upsertUser,
} from './session-store';

const LOGIN_COOKIE = 'lockin_login';
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const IDP_TIMEOUT_MS = 10_000;
/** What the app asks the IdP for: the account, and its name, picture and email for the account menu. */
export const SIGN_IN_SCOPE = 'openid profile email';

const DiscoverySchema = z.object({
  issuer: z.string().min(1),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  userinfo_endpoint: z.url().optional(),
  /** The IdP's signing keys, read only to check its account-deletion notices (auth/account-deleted.ts). */
  jwks_uri: z.url().optional(),
});
export type Discovery = z.infer<typeof DiscoverySchema>;

const TokenResponseSchema = z.object({ id_token: z.string().min(1), access_token: z.string().min(1).optional() });

export interface AuthRoutesOptions {
  config: ServerConfig;
  db: Db;
  now: () => Date;
}

/** The IdP's discovery document, cached for an hour. */
export function discoveryClient(auth: AuthConfig): () => Promise<Discovery> {
  let cached: { at: number; doc: Discovery } | null = null;
  return async () => {
    if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;
    const res = await fetch(`${auth.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(IDP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`discovery answered ${res.status}`);
    const doc = DiscoverySchema.parse(await res.json());
    if (doc.issuer !== auth.issuer) throw new Error('discovery issuer does not match AUTH_ISSUER');
    cached = { at: Date.now(), doc };
    return doc;
  };
}

/**
 * The account's profile from the userinfo endpoint, or null when there is none to read or it does not answer
 * properly: sign-in goes on, the stored profile stays as it was. Only the status is logged, never the answer.
 */
async function fetchProfile(doc: Discovery, accessToken: string | undefined, sub: string): Promise<AccountProfile | null> {
  if (!doc.userinfo_endpoint || !accessToken) return null;
  try {
    const res = await fetch(doc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(IDP_TIMEOUT_MS),
    });
    const profile = res.ok ? profileFromUserinfo(await res.json().catch(() => null), sub) : null;
    if (!profile) console.warn('userinfo not used', res.status);
    return profile;
  } catch (error) {
    console.warn('userinfo failed', safeErrorText(error));
    return null;
  }
}

/** `?login=<result>` on the return path, so the page can say what happened. */
function withLoginResult(path: string, result: 'fail' | 'unavailable' | 'busy'): string {
  const url = new URL(path, 'http://app.invalid');
  url.searchParams.set('login', result);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function authRoutes({ config, db, now }: AuthRoutesOptions): Router {
  const router = express.Router();
  const { auth } = config;
  const discover = auth ? discoveryClient(auth) : null;
  const secure = config.nodeEnv === 'production';
  // Only the start is limited: a callback is worthless without the sealed state cookie a start hands out. Over the
  // limit the person lands back on the page with a notice, not on a bare 429.
  const signInLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.signInLimitPer15Min,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => res.redirect(withLoginResult(safeReturnPath(req.query.return), 'busy')),
  });

  router.get('/api/session', async (req, res) => {
    const token = readSessionToken(req, config);
    const session = token ? await findSession(db, token, now()) : null;
    const user = session ? await findProfile(db, session.userId) : null;
    res.set('Cache-Control', 'no-store').json(user ? { signedIn: true, signInAvailable: auth !== null, user } : { signedIn: false, signInAvailable: auth !== null });
  });

  router.get('/auth/login', signInLimit, async (req, res) => {
    const returnTo = safeReturnPath(req.query.return);
    if (!auth || !discover) {
      res.redirect(withLoginResult(returnTo, 'unavailable'));
      return;
    }
    const lang = req.query.lang === 'en' ? 'en' : 'vi';
    // `signup=1`: the person pressed a sign-up button, so the IdP opens on making an account (its screen links to
    // sign-in for people who already have one). Plain sign-in links never send it.
    const signUp = req.query.signup === '1';
    try {
      const doc = await discover();
      const state = newLoginState(returnTo, now().getTime());
      res.cookie(LOGIN_COOKIE, sealState(state, auth.clientSecret), { httpOnly: true, secure, sameSite: 'lax', path: '/auth', maxAge: 600_000 });
      const url = new URL(doc.authorization_endpoint);
      url.search = new URLSearchParams({
        client_id: auth.clientId,
        redirect_uri: auth.redirectUri,
        response_type: 'code',
        scope: SIGN_IN_SCOPE,
        state: state.state,
        nonce: state.nonce,
        code_challenge: codeChallenge(state.verifier),
        code_challenge_method: 'S256',
        ui_locales: lang,
        ...(signUp ? { prompt: 'create' } : {}),
      }).toString();
      res.redirect(url.href);
    } catch (error) {
      console.warn('sign-in start failed', safeErrorText(error));
      res.redirect(withLoginResult(returnTo, 'fail'));
    }
  });

  router.get('/auth/callback', async (req, res) => {
    const state = auth ? openState(readCookie(req, LOGIN_COOKIE), auth.clientSecret, now().getTime()) : null;
    res.clearCookie(LOGIN_COOKIE, { httpOnly: true, secure, sameSite: 'lax', path: '/auth' });
    const fail = (): void => res.redirect(withLoginResult(state?.returnTo ?? '/', 'fail'));
    const code = req.query.code;
    if (!auth || !discover || !state || req.query.state !== state.state || typeof code !== 'string' || code === '') {
      fail();
      return;
    }
    try {
      const doc = await discover();
      const basic = Buffer.from(`${encodeURIComponent(auth.clientId)}:${encodeURIComponent(auth.clientSecret)}`).toString('base64');
      const tokenRes = await fetch(doc.token_endpoint, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: auth.redirectUri, code_verifier: state.verifier }),
        signal: AbortSignal.timeout(IDP_TIMEOUT_MS),
      });
      const body = TokenResponseSchema.safeParse(await tokenRes.json().catch(() => null));
      const sub =
        tokenRes.ok && body.success ? subFromIdToken(body.data.id_token, { issuer: doc.issuer, clientId: auth.clientId, nonce: state.nonce }, now().getTime()) : null;
      if (!sub) {
        console.warn('sign-in rejected', tokenRes.status);
        fail();
        return;
      }
      const profile = await fetchProfile(doc, body.data?.access_token, sub);
      const at = now();
      const userId = await upsertUser(db, sub, profile, at);
      // Signing in again replaces the browser's previous session; expired rows of anyone go too.
      const previous = readSessionToken(req, config);
      if (previous) await deleteSessionByToken(db, previous);
      await purgeExpiredSessions(db, at);
      setSessionCookie(res, config, await createSession(db, userId, at));
      res.redirect(state.returnTo);
    } catch (error) {
      console.warn('sign-in failed', safeErrorText(error));
      fail();
    }
  });

  // Same-origin check applies (app.ts): a cross-site page cannot sign the person out. The creator cookies of plans
  // saved to an account go too: the account is those plans' key, the cookies open nothing.
  router.post('/auth/logout', async (req, res) => {
    const token = readSessionToken(req, config);
    if (token) await deleteSessionByToken(db, token);
    clearSessionCookie(res, config);
    const held = listPlanCookies(req, config, 'c').map((cookie) => cookie.planId);
    for (const planId of await findOwnedPlanIds(db, held)) clearPlanCookie(res, config, 'c', planId);
    res.status(204).end();
  });

  return router;
}
