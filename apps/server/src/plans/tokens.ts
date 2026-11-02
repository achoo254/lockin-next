/**
 * Share-link and guest tokens: 32 random bytes as base64url. Only their sha256 is stored (hashToken), so a
 * database leak hands out neither links nor guest identities. A guest's token lives in one HttpOnly cookie per plan.
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { CookieOptions, Response } from 'express';
import type { ServerConfig } from '../config';
import { readCookie } from '../auth/session-cookie';

export { hashToken } from '../auth/session-store';

/** Exactly what newToken() makes: 32 bytes are 43 base64url characters. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isTokenShape(value: string | undefined): value is string {
  return value !== undefined && TOKEN_SHAPE.test(value);
}

/**
 * One cookie per plan, named after the plan id (not the share token, so rotating the link keeps the guests).
 * Production uses the `__Host-` prefix (Secure, Path=/, no Domain), like the session cookie.
 */
function cookiePrefix(config: ServerConfig): string {
  return config.nodeEnv === 'production' ? '__Host-lockin_g_' : 'lockin_g_';
}

function cookieName(config: ServerConfig, planId: string): string {
  return `${cookiePrefix(config)}${planId.replaceAll('-', '')}`;
}

function cookieOptions(config: ServerConfig): CookieOptions {
  return { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', path: '/' };
}

/** Every `name=value` pair of the Cookie header. */
function cookiePairs(req: Pick<IncomingMessage, 'headers'>): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) pairs.push([part.slice(0, eq).trim(), part.slice(eq + 1).trim()]);
  }
  return pairs;
}

export function readGuestToken(req: Pick<IncomingMessage, 'headers'>, config: ServerConfig, planId: string): string | null {
  const value = readCookie(req, cookieName(config, planId));
  return isTokenShape(value) ? value : null;
}

/** The cookie lives until the plan is deleted, so the guest stays recognised as long as the plan exists. */
export function setGuestToken(res: Response, config: ServerConfig, planId: string, token: string, until: Date, now: Date): void {
  res.cookie(cookieName(config, planId), token, { ...cookieOptions(config), maxAge: Math.max(0, until.getTime() - now.getTime()) });
}

/** Most guest cookies read when a plan is made (a browser in that many plans is not a person's first plan anyway). */
const MAX_GUEST_COOKIES = 50;

/** The guest cookies of every plan this browser opened: plan id (with dashes) and token. */
export function readAllGuestTokens(req: Pick<IncomingMessage, 'headers'>, config: ServerConfig): Array<{ planId: string; token: string }> {
  const prefix = cookiePrefix(config);
  const found: Array<{ planId: string; token: string }> = [];
  for (const [name, value] of cookiePairs(req)) {
    if (found.length >= MAX_GUEST_COOKIES) break;
    if (!name.startsWith(prefix) || !isTokenShape(value)) continue;
    const hex = name.slice(prefix.length);
    if (!/^[0-9a-f]{32}$/.test(hex)) continue;
    const planId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    found.push({ planId, token: value });
  }
  return found;
}
