/**
 * Signature check of a compact JWS the IdP signed (its account-deletion notices), against the keys it publishes at
 * the discovery document's `jwks_uri`, with node:crypto only. Only ES256 is accepted, the algorithm auth.hoandat.com
 * signs with: `none`, HMAC and anything else are refused, so a token can never pick a weaker check. The keys are
 * cached for a day and refetched at most once a minute when a token names a key the cache does not hold (rotation).
 * The key URL must live on the issuer's own origin, so a tampered discovery document cannot point the lookup elsewhere.
 */
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { Discovery } from './auth-routes';

const JWKS_TTL_MS = 24 * 60 * 60 * 1000;
const JWKS_REFETCH_MS = 60 * 1000;
const IDP_TIMEOUT_MS = 10_000;

/** A compact JWS split and decoded. */
export interface DecodedJws {
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
  readonly signingInput: string;
  readonly signature: Buffer;
}

type Jwk = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** The parts of a compact JWS; null when `token` is not one. */
export function decodeJws(token: string): DecodedJws | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawHeader = '', rawPayload = '', rawSignature = ''] = parts;
  const header = decodeJson(rawHeader);
  const payload = decodeJson(rawPayload);
  if (!header || !payload || rawSignature === '') return null;
  return { header, payload, signingInput: `${rawHeader}.${rawPayload}`, signature: Buffer.from(rawSignature, 'base64url') };
}

function publicKey(jwk: Jwk): KeyObject | null {
  const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  try {
    // Only the public members of a P-256 key; node:crypto refuses anything that is not a valid public key.
    return createPublicKey({ key: { kty: str(jwk.kty), crv: str(jwk.crv), x: str(jwk.x), y: str(jwk.y) }, format: 'jwk' });
  } catch {
    return null;
  }
}

/** Whether `jws` is ES256 and carries a valid signature by one of `keys` (matching its `kid` when it names one). */
export function verifyEs256(jws: DecodedJws, keys: readonly Jwk[]): boolean {
  if (jws.header.alg !== 'ES256') return false;
  const kid = jws.header.kid;
  const data = Buffer.from(jws.signingInput);
  return keys
    .filter(
      (k) =>
        k.kty === 'EC' &&
        k.crv === 'P-256' &&
        (k.use === undefined || k.use === 'sig') &&
        (k.alg === undefined || k.alg === 'ES256') &&
        (typeof kid !== 'string' || k.kid === kid),
    )
    .some((jwk) => {
      const key = publicKey(jwk);
      if (!key) return false;
      try {
        return verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, jws.signature);
      } catch {
        return false;
      }
    });
}

export interface IdpSignature {
  /**
   * The payload of `jws` when the IdP signed it, or null (wrong algorithm, unknown key, bad signature). Throws when
   * the IdP's keys cannot be read, so the caller answers 503 and the IdP retries.
   */
  verifiedPayload(jws: DecodedJws): Promise<Record<string, unknown> | null>;
}

export function idpSignature(issuer: string, discover: () => Promise<Discovery>, now: () => number = Date.now): IdpSignature {
  let cached: { at: number; keys: Jwk[] } | null = null;
  const issuerOrigin = new URL(issuer).origin;

  async function signingKeys(refetch: boolean): Promise<Jwk[]> {
    const age = cached ? now() - cached.at : Infinity;
    if (cached && age < JWKS_TTL_MS && (!refetch || age < JWKS_REFETCH_MS)) return cached.keys;
    const { jwks_uri: jwksUri } = await discover();
    if (!jwksUri) throw new Error('discovery has no jwks_uri');
    if (new URL(jwksUri).origin !== issuerOrigin) throw new Error('jwks_uri is not on the issuer');
    const res = await fetch(jwksUri, { signal: AbortSignal.timeout(IDP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`jwks ${res.status}`);
    const body: unknown = await res.json();
    if (!isRecord(body) || !Array.isArray(body.keys)) throw new Error('jwks has no keys');
    cached = { at: now(), keys: body.keys.filter(isRecord) };
    return cached.keys;
  }

  return {
    async verifiedPayload(jws) {
      if (jws.header.alg !== 'ES256') return null;
      if (verifyEs256(jws, await signingKeys(false))) return jws.payload;
      return verifyEs256(jws, await signingKeys(true)) ? jws.payload : null;
    },
  };
}
