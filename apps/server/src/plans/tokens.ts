/**
 * Share-link, guest and creator tokens: 32 random bytes as base64url. Only their sha256 is stored (hashToken), so a
 * database leak hands out neither links nor identities. A guest's token, and the creator token of a plan made in this
 * browser, each live in one HttpOnly cookie per plan.
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
 * Per-plan cookies, named after the plan id (not the share token, so rotating the link keeps them): `g` holds a
 * guest's token, `c` the creator token of a plan made in this browser. Production uses the `__Host-` prefix (Secure,
 * Path=/, no Domain), like the session cookie.
 */
type PlanCookieKind = 'g' | 'c';

function cookiePrefix(config: ServerConfig, kind: PlanCookieKind): string {
  return `${config.nodeEnv === 'production' ? '__Host-' : ''}lockin_${kind}_`;
}

function cookieName(config: ServerConfig, kind: PlanCookieKind, planId: string): string {
  return `${cookiePrefix(config, kind)}${planId.replaceAll('-', '')}`;
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

function readPlanToken(req: Pick<IncomingMessage, 'headers'>, config: ServerConfig, kind: PlanCookieKind, planId: string): string | null {
  const value = readCookie(req, cookieName(config, kind, planId));
  return isTokenShape(value) ? value : null;
}

function setPlanToken(res: Response, config: ServerConfig, kind: PlanCookieKind, planId: string, token: string, until: Date, now: Date): void {
  res.cookie(cookieName(config, kind, planId), token, { ...cookieOptions(config), maxAge: Math.max(0, until.getTime() - now.getTime()) });
}

/**
 * Most per-plan cookies of one kind read from a request (when a plan is made, and for "Kèo của tôi"): keeps the work
 * per request small, and a browser in that many plans is not a person's first plan anyway.
 */
export const MAX_PLAN_COOKIES = 50;

/** The cookies of one kind in the request: plan id (with dashes) and token. */
function readAllPlanTokens(req: Pick<IncomingMessage, 'headers'>, config: ServerConfig, kind: PlanCookieKind): Array<{ planId: string; token: string }> {
  const prefix = cookiePrefix(config, kind);
  const found: Array<{ planId: string; token: string }> = [];
  for (const [name, value] of cookiePairs(req)) {
    if (found.length >= MAX_PLAN_COOKIES) break;
    if (!name.startsWith(prefix) || !isTokenShape(value)) continue;
    const hex = name.slice(prefix.length);
    if (!/^[0-9a-f]{32}$/.test(hex)) continue;
    const planId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    found.push({ planId, token: value });
  }
  return found;
}

export function readGuestToken(req: Pick<IncomingMessage, 'headers'>, config: ServerConfig, planId: string): string | null {
  return readPlanToken(req, config, 'g', planId);
}

/** The guest cookie lives until `until` (the plan turning read-only), so the guest stays recognised while it matters. */
export function setGuestToken(res: Response, config: ServerConfig, planId: string, token: string, until: Date, now: Date): void {
  setPlanToken(res, config, 'g', planId, token, until, now);
}

/** The guest cookies of every plan this browser joined. */
export function readAllGuestTokens(req: Pick<IncomingMessage, 'headers'>, config: ServerConfig): Array<{ planId: string; token: string }> {
  return readAllPlanTokens(req, config, 'g');
}

/** The creator token of the plan from this browser's cookie, if any (not yet checked against the plan). */
export function readCreatorToken(req: Pick<IncomingMessage, 'headers'>, config: ServerConfig, planId: string): string | null {
  return readPlanToken(req, config, 'c', planId);
}

/** The creator cookie lives until the plan is deleted (`until`), so the browser keeps managing it as long as it exists. */
export function setCreatorToken(res: Response, config: ServerConfig, planId: string, token: string, until: Date, now: Date): void {
  setPlanToken(res, config, 'c', planId, token, until, now);
}

/** The creator cookies of every plan made in (or handed to, by its manage link) this browser. */
export function readAllCreatorTokens(req: Pick<IncomingMessage, 'headers'>, config: ServerConfig): Array<{ planId: string; token: string }> {
  return readAllPlanTokens(req, config, 'c');
}
