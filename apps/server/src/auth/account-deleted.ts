/**
 * `POST /api/idp/account-deleted` (auth-next ADR 0018): an account was deleted at auth.hoandat.com/account, the only
 * place an account is deleted, so what Lockin keeps for it goes too, at once (plans/account-data.ts: the account, its
 * sessions, its plans; a plan others joined is handed to the earliest of them). The IdP calls it server to server with
 * a signed Security Event Token as the body (`Content-Type: application/secevent+jwt`) and no Origin, so app.ts mounts
 * it ahead of the same-origin check.
 *
 * Answers 202 once the data is deleted, or when nothing here belongs to that `sub` (never signed in, or already
 * deleted: a retried notice is a no-op); 400 when the body is not a SET; 401 when the SET is not a valid one from our
 * IdP for this URL (alg, signature, iss, aud, exp, event, sub); 503 when sign-in is off, the IdP's keys cannot be read
 * or the deletion failed, so the IdP retries. Neither the SET nor the `sub` is logged, only the internal account id.
 */
import express, { type Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { ServerConfig } from '../config';
import type { Db } from '../db/client';
import { safeErrorText } from '../log-error';
import { deleteAccountData } from '../plans/account-data';
import { discoveryClient } from './auth-routes';
import { type DecodedJws, decodeJws, idpSignature } from './idp-signature';

export const ACCOUNT_DELETED_PATH = '/api/idp/account-deleted';
export const ACCOUNT_DELETED_EVENT = 'urn:hoandat:auth:event:account.deleted';
const SET_MEDIA_TYPE = 'application/secevent+jwt';
const SET_TYPES = new Set(['secevent+jwt', 'application/secevent+jwt']);
/** Tolerance for clock differences between the IdP and this server. */
const CLOCK_SKEW_S = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a JWS presents itself as a SET (its `typ`, compared without case as RFC 7515 §4.1.9 allows). */
export function isSecurityEventToken(jws: DecodedJws): boolean {
  const { typ } = jws.header;
  return typeof typ === 'string' && SET_TYPES.has(typ.toLowerCase());
}

/** The deleted account's `sub` when the claims of a signature-checked SET are right for `expect`; null otherwise. */
export function deletedSub(claims: Record<string, unknown>, expect: { issuer: string; audience: string }, nowMs: number): string | null {
  if (claims.iss !== expect.issuer || claims.aud !== expect.audience) return null;
  const nowS = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S <= nowS) return null;
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > nowS) return null;
  if (!isRecord(claims.events) || !isRecord(claims.events[ACCOUNT_DELETED_EVENT])) return null;
  return typeof claims.sub === 'string' && claims.sub !== '' ? claims.sub : null;
}

export interface AccountDeletedOptions {
  config: ServerConfig;
  db: Db;
  now: () => Date;
}

export function accountDeletedRoute({ config, db, now }: AccountDeletedOptions): Router {
  const router = express.Router();
  const auth = config.auth;
  const signature = auth ? idpSignature(auth.issuer, discoveryClient(auth), () => now().getTime()) : null;
  const audience = `${config.publicOrigin}${ACCOUNT_DELETED_PATH}`;
  // The IdP calls from one address and retries with backoff: a refused notice is only delayed.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.signInLimitPer15Min,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).end(),
  });

  router.post(ACCOUNT_DELETED_PATH, limiter, express.text({ type: SET_MEDIA_TYPE, limit: '8kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const body: unknown = req.body;
    const jws = typeof body === 'string' ? decodeJws(body.trim()) : null;
    if (!jws || !isSecurityEventToken(jws)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    if (!auth || !signature) {
      // Sign-in is off here: no IdP to check the signature against. The IdP keeps the notice and retries.
      res.status(503).end();
      return;
    }
    if (jws.header.alg !== 'ES256') {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    let sub: string | null;
    try {
      const payload = await signature.verifiedPayload(jws);
      sub = payload ? deletedSub(payload, { issuer: auth.issuer, audience }, now().getTime()) : null;
    } catch (error) {
      console.warn('account deletion notice: IdP keys unavailable', safeErrorText(error));
      res.status(503).end();
      return;
    }
    if (!sub) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }

    let result: Awaited<ReturnType<typeof deleteAccountData>>;
    try {
      result = await deleteAccountData(db, sub, now());
    } catch (error) {
      console.error('account deletion notice: deletion failed', safeErrorText(error));
      res.status(503).end();
      return;
    }
    if (!result) console.info('account deletion notice: no account here');
    else console.info('account deletion notice: account deleted', result.userId ?? '-', `plans deleted ${result.deletedPlans}, handed over ${result.handedOverPlans}`);
    res.status(202).end();
  });

  return router;
}
