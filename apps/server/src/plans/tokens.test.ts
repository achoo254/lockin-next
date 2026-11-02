import type { CookieOptions, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '../config';
import { hashToken, isTokenShape, newToken, readAllGuestTokens, readGuestToken, setGuestToken } from './tokens';

const PLAN = '0b9f6a52-3c1d-4e2f-9a8b-7c6d5e4f3a21';
const dev = loadConfig({ NODE_ENV: 'test' });
const prod: ServerConfig = { ...dev, nodeEnv: 'production' };

function captureCookie(config: ServerConfig): { name: string; value: string; options: CookieOptions } {
  let captured: { name: string; value: string; options: CookieOptions } | null = null;
  const res = {
    cookie(name: string, value: string, options: CookieOptions) {
      captured = { name, value, options };
      return this;
    },
  };
  const now = new Date('2026-11-02T00:00:00Z');
  setGuestToken(res as unknown as Response, config, PLAN, 'x'.repeat(43), new Date(now.getTime() + 1000), now);
  if (!captured) throw new Error('no cookie set');
  return captured;
}

describe('tokens', () => {
  it('makes 32 random bytes as base64url and stores only their sha256', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isTokenShape(token)).toBe(true);
    expect(newToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(isTokenShape('short')).toBe(false);
    expect(isTokenShape(`${token}x`)).toBe(false);
  });

  it('keeps the guest token in an HttpOnly, SameSite=Lax cookie for the whole site, Secure in production', () => {
    const local = captureCookie(dev);
    expect(local.name).toBe(`lockin_g_${PLAN.replaceAll('-', '')}`);
    expect(local.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: false, maxAge: 1000 });
    const production = captureCookie(prod);
    expect(production.name).toBe(`__Host-lockin_g_${PLAN.replaceAll('-', '')}`);
    expect(production.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: true });
  });

  it('reads one plan’s guest token, and every plan’s for the source of a new plan', () => {
    const token = newToken();
    const other = newToken();
    const cookie = `lockin_session=abc; lockin_g_${PLAN.replaceAll('-', '')}=${token}; lockin_g_${'f'.repeat(32)}=${other}; lockin_g_bad=${token}; lockin_g_${'e'.repeat(32)}=short`;
    const req = { headers: { cookie } };
    expect(readGuestToken(req, dev, PLAN)).toBe(token);
    expect(readGuestToken(req, dev, 'ffffffff-ffff-ffff-ffff-fffffffffff0')).toBeNull();
    expect(readAllGuestTokens(req, dev)).toEqual([
      { planId: PLAN, token },
      { planId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', token: other },
    ]);
    // The production prefix is not read in dev and the other way round.
    expect(readAllGuestTokens(req, prod)).toEqual([]);
  });
});
