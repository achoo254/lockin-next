import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
export const DEFAULT_ISSUER = 'https://auth.hoandat.com';
export const DEFAULT_CLIENT_ID = 'lockin-web';

/** An env line with nothing after `=` counts as not set. */
const emptyIsUnset = (value: unknown): unknown => (value === '' ? undefined : value);

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5300),
  /** Public origin of the app; the sign-in callback is PUBLIC_URL/auth/callback. */
  PUBLIC_URL: z.preprocess(emptyIsUnset, z.url().default('http://localhost:5301')),
  DATABASE_URL: z.preprocess(emptyIsUnset, z.url().optional()),
  /** PGlite directory when DATABASE_URL is unset; `memory` keeps it in RAM (E2E starts from an empty database). */
  PGLITE_DIR: z.preprocess(emptyIsUnset, z.string().min(1).optional()),
  AUTH_ISSUER: z.preprocess(emptyIsUnset, z.url().default(DEFAULT_ISSUER)),
  AUTH_CLIENT_ID: z.preprocess(emptyIsUnset, z.string().min(1).default(DEFAULT_CLIENT_ID)),
  /** Secret of the confidential client lockin-web. Unset: sign-in is off (guests still see the pages). */
  AUTH_CLIENT_SECRET: z.preprocess(emptyIsUnset, z.string().min(32).optional()),
  /** 32 bytes, base64: encrypts each plan's share token so its creator can see the link again. */
  SHARE_TOKEN_KEY: z.preprocess(emptyIsUnset, z.string().optional()),
});

/** Length of the AES-256-GCM key in SHARE_TOKEN_KEY. */
const SHARE_TOKEN_KEY_BYTES = 32;

/** SHARE_TOKEN_KEY as 32 bytes (base64 or base64url); null when it is not exactly that. */
function decodeShareTokenKey(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return bytes.length === SHARE_TOKEN_KEY_BYTES ? bytes : null;
}

export interface AuthConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface ServerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  /** Origin of the web app: the only origin allowed to make state-changing requests (CSRF check). */
  publicOrigin: string;
  databaseUrl: string | undefined;
  /** PGlite location when no DATABASE_URL: a directory, null for in-memory, undefined for the dev default. */
  pgliteDir: string | null | undefined;
  /** Sign-in through the hoandat.com account; null when AUTH_CLIENT_SECRET is not set. */
  auth: AuthConfig | null;
  /**
   * Sign-in starts per 15 minutes per IP. Generous: mobile carriers put many people behind one address, and the
   * real client IP is the one nginx forwards (Cloudflare's real-IP restore is global on the host).
   */
  signInLimitPer15Min: number;
  /** Plans a signed-in account can make per hour. */
  planCreateLimitPerHour: number;
  /** Joins (and renames) per hour per IP. */
  joinLimitPerHour: number;
  /** Vote and going/not submissions per hour per IP. */
  voteLimitPerHour: number;
  /**
   * AES-256-GCM key of the stored share tokens (SHARE_TOKEN_KEY). Outside production a missing key is replaced by
   * a random one for this process: links made before a restart then cannot be shown again (rotating makes a new one).
   */
  shareTokenKey: Buffer;
}

/** Validates env once at startup; throws naming the offending keys (never their values) so the process fails fast. */
export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid server env: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const publicUrl = new URL(e.PUBLIC_URL);
  const issuerUrl = new URL(e.AUTH_ISSUER);
  if (production) {
    const missing = [!e.DATABASE_URL && 'DATABASE_URL', !e.AUTH_CLIENT_SECRET && 'AUTH_CLIENT_SECRET', !e.SHARE_TOKEN_KEY && 'SHARE_TOKEN_KEY'].filter(Boolean);
    if (missing.length > 0) throw new Error(`Invalid server env: ${missing.join(', ')} required in production`);
    if (publicUrl.protocol !== 'https:') throw new Error('Invalid server env: PUBLIC_URL must be https in production');
    if (e.PGLITE_DIR) throw new Error('Invalid server env: PGLITE_DIR is dev/test only');
  }
  // https only; plain http only for a local fake IdP outside production (E2E).
  if (issuerUrl.protocol !== 'https:' && (production || issuerUrl.protocol !== 'http:' || !LOOPBACK_HOSTS.includes(issuerUrl.hostname))) {
    throw new Error('Invalid server env: AUTH_ISSUER must be https (http only on loopback outside production)');
  }
  // The code exchange is only as trustworthy as the TLS it travels over.
  if (e.AUTH_CLIENT_SECRET && env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('Invalid server env: NODE_TLS_REJECT_UNAUTHORIZED=0 is not allowed with sign-in');
  }
  let shareTokenKey: Buffer;
  if (e.SHARE_TOKEN_KEY) {
    const decoded = decodeShareTokenKey(e.SHARE_TOKEN_KEY);
    if (!decoded) throw new Error(`Invalid server env: SHARE_TOKEN_KEY must be ${SHARE_TOKEN_KEY_BYTES} bytes in base64`);
    shareTokenKey = decoded;
  } else {
    shareTokenKey = randomBytes(SHARE_TOKEN_KEY_BYTES);
    console.warn('SHARE_TOKEN_KEY unset: using a random key for this process (share links made now cannot be shown after a restart)');
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    publicOrigin: publicUrl.origin,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR === 'memory' ? null : e.PGLITE_DIR,
    auth: e.AUTH_CLIENT_SECRET
      ? {
          issuer: issuerUrl.href.replace(/\/$/, ''),
          clientId: e.AUTH_CLIENT_ID,
          clientSecret: e.AUTH_CLIENT_SECRET,
          redirectUri: `${publicUrl.origin}/auth/callback`,
        }
      : null,
    signInLimitPer15Min: 100,
    planCreateLimitPerHour: 20,
    joinLimitPerHour: 30,
    voteLimitPerHour: 120,
    shareTokenKey,
  };
}
