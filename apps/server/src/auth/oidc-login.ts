/**
 * The pure parts of "sign in with a hoandat.com account" (OpenID Connect Code + PKCE against auth-next,
 * client `lockin-web`, scope `openid profile email`): the signed state cookie, the ID token checks and the reading
 * of the userinfo answer. The account is its `sub`; the name, email and picture only label it in the header's
 * account menu. The ID token comes straight from the token endpoint over TLS with client authentication,
 * so its signature is not re-checked here (OIDC Core 3.1.3.7, step 6); issuer, audience, expiry and nonce are.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AccountProfile } from './session-store';

const LoginStateSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  verifier: z.string().min(43),
  /** Same-site path the person goes back to after signing in. */
  returnTo: z.string(),
  /** Unix seconds after which the attempt is void. */
  exp: z.number().int(),
});

export type LoginState = z.infer<typeof LoginStateSchema>;

const LOGIN_TTL_SECONDS = 600;
const b64url = (buf: Buffer): string => buf.toString('base64url');

/** A same-site path to return to, or "/" for anything else (open-redirect guard). */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value.length <= 200 ? value : '/';
}

export function newLoginState(returnTo: string, now = Date.now()): LoginState {
  return {
    state: b64url(randomBytes(16)),
    nonce: b64url(randomBytes(16)),
    verifier: b64url(randomBytes(32)),
    returnTo: safeReturnPath(returnTo),
    exp: Math.floor(now / 1000) + LOGIN_TTL_SECONDS,
  };
}

/** S256 code challenge of the PKCE verifier (RFC 7636 §4.2). */
export function codeChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

/** The state as a cookie value, signed with the client secret. */
export function sealState(state: LoginState, key: string): string {
  const body = b64url(Buffer.from(JSON.stringify(state)));
  const mac = b64url(createHmac('sha256', key).update(body).digest());
  return `${body}.${mac}`;
}

export function openState(value: string | undefined, key: string, now = Date.now()): LoginState | null {
  if (!value) return null;
  const [body, mac, extra] = value.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const want = Buffer.from(b64url(createHmac('sha256', key).update(body).digest()));
  const got = Buffer.from(mac);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
  const parsed = LoginStateSchema.safeParse(json);
  return parsed.success && parsed.data.exp > Math.floor(now / 1000) ? parsed.data : null;
}

/** The account `sub` from the ID token, or null when any check fails. */
export function subFromIdToken(idToken: string, expect: { issuer: string; clientId: string; nonce: string }, now = Date.now()): string | null {
  const part = idToken.split('.')[1];
  if (!part) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(part, 'base64url').toString());
  } catch {
    return null;
  }
  if (typeof claims !== 'object' || claims === null) return null;
  const { iss, aud, exp, nonce, sub } = claims as Record<string, unknown>;
  const audOk = Array.isArray(aud) ? aud.includes(expect.clientId) : aud === expect.clientId;
  const fresh = typeof exp === 'number' && exp > Math.floor(now / 1000);
  if (iss !== expect.issuer || !audOk || !fresh || nonce !== expect.nonce || typeof sub !== 'string' || sub === '') return null;
  return sub;
}

/** Longest values kept from userinfo; anything longer is dropped, not cut. */
const MAX_NAME = 200;
const MAX_EMAIL = 320;
const MAX_PICTURE_URL = 2048;

/** A trimmed string of at most `max` characters, else null. */
function shortText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text !== '' && text.length <= max ? text : null;
}

/** Something shaped like an email address, else null. */
function emailAddress(value: unknown): string | null {
  const text = shortText(value, MAX_EMAIL);
  return text && /^[^\s@]+@[^\s@]+$/.test(text) ? text : null;
}

/** An https picture URL (the account menu shows no other kind), else null. */
function pictureUrl(value: unknown): string | null {
  const text = shortText(value, MAX_PICTURE_URL);
  if (!text) return null;
  try {
    return new URL(text).protocol === 'https:' ? text : null;
  } catch {
    return null;
  }
}

/**
 * The profile in a userinfo answer, or null when it is not about `sub` (OIDC Core 5.3.2: the userinfo `sub` must
 * match the ID token's, or the answer is not used). The name falls back to the account's username.
 */
export function profileFromUserinfo(body: unknown, sub: string): AccountProfile | null {
  if (typeof body !== 'object' || body === null) return null;
  const claims = body as Record<string, unknown>;
  if (claims.sub !== sub) return null;
  return {
    name: shortText(claims.name, MAX_NAME) ?? shortText(claims.preferred_username, MAX_NAME),
    email: emailAddress(claims.email),
    picture: pictureUrl(claims.picture),
  };
}
