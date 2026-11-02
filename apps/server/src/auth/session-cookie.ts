import type { IncomingMessage } from 'node:http';
import type { CookieOptions, Response } from 'express';
import type { ServerConfig } from '../config';
import { SESSION_ABSOLUTE_MS } from './session-store';

/**
 * Production uses the `__Host-` prefix, which browsers only accept with `Secure`, `Path=/` and no `Domain`.
 * Dev drops `Secure` (and so the prefix): the dev server runs on plain http.
 */
export function sessionCookieName(config: ServerConfig): string {
  return config.nodeEnv === 'production' ? '__Host-lockin_session' : 'lockin_session';
}

function cookieOptions(config: ServerConfig): CookieOptions {
  return { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', path: '/' };
}

export function setSessionCookie(res: Response, config: ServerConfig, token: string): void {
  res.cookie(sessionCookieName(config), token, { ...cookieOptions(config), maxAge: SESSION_ABSOLUTE_MS });
}

export function clearSessionCookie(res: Response, config: ServerConfig): void {
  res.clearCookie(sessionCookieName(config), cookieOptions(config));
}

/** Tokens are base64url of 32 bytes; anything else is not ours. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

/** One cookie from the Cookie header (avoids a parser dependency for the two cookies the app reads). */
export function readCookie(req: Pick<IncomingMessage, 'headers'>, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function readSessionToken(req: Pick<IncomingMessage, 'headers'>, config: ServerConfig): string | null {
  const value = readCookie(req, sessionCookieName(config));
  return value && TOKEN_SHAPE.test(value) ? value : null;
}
