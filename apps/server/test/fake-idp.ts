/**
 * Test-only stand-in for auth-next: discovery, an authorize endpoint that consents at once, a token endpoint
 * that checks client_secret_basic, the redirect URI and PKCE before returning an ID token and an access token,
 * and a userinfo endpoint that answers for those access tokens. Used by the server tests and the Playwright
 * E2E; the app itself always talks to the real IdP's endpoints.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

export interface FakeIdpOptions {
  clientId: string;
  clientSecret: string;
  /** The account that signs in next (setSub switches it). */
  sub: string;
  /** Fixed port (E2E); 0 or unset picks a free one. */
  port?: number;
  /** Userinfo claims besides `sub` (name, email, picture…) of the next sign-in (setProfile switches them). */
  profile?: Record<string, unknown>;
}

export interface FakeIdp {
  issuer: string;
  /** Codes handed out so far (a test can check a code is not reused). */
  issuedCodes(): number;
  /** The account the next sign-in is for. */
  setSub(sub: string): void;
  /** The userinfo claims besides `sub` of the next sign-in. */
  setProfile(profile: Record<string, unknown>): void;
  /** Makes userinfo answer 500 (true) or normally (false). */
  failUserinfo(fail: boolean): void;
  close(): Promise<void>;
}

interface PendingCode {
  challenge: string;
  nonce: string;
  redirectUri: string;
}

const b64url = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

export async function startFakeIdp(options: FakeIdpOptions): Promise<FakeIdp> {
  const app = express();
  const codes = new Map<string, PendingCode>();
  let issued = 0;
  /** Access token -> the userinfo answer it gets, fixed when the token is handed out. */
  const accessTokens = new Map<string, Record<string, unknown>>();
  let sub = options.sub;
  let profile = options.profile ?? {};
  let userinfoFails = false;
  let issuer = '';

  app.get('/.well-known/openid-configuration', (_req, res) => {
    res.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/me` });
  });

  app.get('/authorize', (req, res) => {
    const q = req.query;
    if (
      q.client_id !== options.clientId ||
      q.response_type !== 'code' ||
      q.scope !== 'openid profile email' ||
      q.code_challenge_method !== 'S256' ||
      typeof q.code_challenge !== 'string' ||
      typeof q.redirect_uri !== 'string' ||
      typeof q.state !== 'string' ||
      typeof q.nonce !== 'string'
    ) {
      res.status(400).send('bad authorize request');
      return;
    }
    const code = b64url(randomBytes(16));
    codes.set(code, { challenge: q.code_challenge, nonce: q.nonce, redirectUri: q.redirect_uri });
    issued++;
    const back = new URL(q.redirect_uri);
    back.searchParams.set('code', code);
    back.searchParams.set('state', q.state);
    res.redirect(back.href);
  });

  app.post('/token', express.urlencoded({ extended: false }), (req, res) => {
    const expected = `Basic ${Buffer.from(`${encodeURIComponent(options.clientId)}:${encodeURIComponent(options.clientSecret)}`).toString('base64')}`;
    if (req.headers.authorization !== expected) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const pending = typeof body.code === 'string' ? codes.get(body.code) : undefined;
    if (typeof body.code === 'string') codes.delete(body.code);
    const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
    if (
      !pending ||
      body.grant_type !== 'authorization_code' ||
      body.redirect_uri !== pending.redirectUri ||
      b64url(createHash('sha256').update(verifier).digest()) !== pending.challenge
    ) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: issuer, aud: options.clientId, sub, nonce: pending.nonce, iat: now, exp: now + 300 };
    // The relying party does not verify the signature (it got the token over TLS from the token endpoint).
    const idToken = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.${b64url('fake-signature')}`;
    const accessToken = b64url(randomBytes(16));
    accessTokens.set(accessToken, { ...profile, sub });
    res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: 300, id_token: idToken });
  });

  app.get('/me', (req, res) => {
    const claims = accessTokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!claims) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    if (userinfoFails) {
      res.status(500).json({ error: 'server_error' });
      return;
    }
    res.json(claims);
  });

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(options.port ?? 0, '127.0.0.1', () => resolve(s));
  });
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    issuer,
    issuedCodes: () => issued,
    setSub: (next) => {
      sub = next;
    },
    setProfile: (next) => {
      profile = next;
    },
    failUserinfo: (fail) => {
      userinfoFails = fail;
    },
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
