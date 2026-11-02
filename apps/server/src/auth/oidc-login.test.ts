import { describe, expect, it } from 'vitest';
import { codeChallenge, newLoginState, openState, profileFromUserinfo, safeReturnPath, sealState, subFromIdToken } from './oidc-login';

const KEY = 'k'.repeat(40);
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (claims: Record<string, unknown>): string => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;

describe('login state cookie', () => {
  it('opens what it sealed, and nothing tampered with, expired or signed with another key', () => {
    const now = Date.UTC(2026, 9, 26);
    const state = newLoginState('/?x=1', now);
    const sealed = sealState(state, KEY);
    expect(openState(sealed, KEY, now)).toEqual(state);
    expect(openState(sealed, 'x'.repeat(40), now)).toBeNull();
    expect(openState(`${sealed}x`, KEY, now)).toBeNull();
    expect(openState(sealed.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')), KEY, now)).toBeNull();
    expect(openState(sealed, KEY, now + 601_000)).toBeNull();
    expect(openState(undefined, KEY, now)).toBeNull();
  });

  it('derives the S256 challenge of RFC 7636 appendix B', () => {
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('only returns to same-site paths', () => {
    expect(safeReturnPath('/new?x=1')).toBe('/new?x=1');
    expect(safeReturnPath('//evil.example')).toBe('/');
    expect(safeReturnPath('https://evil.example')).toBe('/');
    expect(safeReturnPath('/\\evil.example')).toBe('/');
    expect(safeReturnPath(undefined)).toBe('/');
    // Browsers drop tabs and newlines from a URL, turning these into "//evil.example".
    for (const unsafe of ['/\t/evil.example', '/\n/evil.example', '/\r\n/evil.example', '/\u0000/evil.example', '\\/evil.example', '/\\/evil.example', `/${'a'.repeat(200)}`]) {
      expect(safeReturnPath(unsafe)).toBe('/');
    }
    expect(safeReturnPath('/k/abc?lang=en#vote')).toBe('/k/abc?lang=en#vote');
    expect(safeReturnPath('/a/../new')).toBe('/new');
  });
});

describe('ID token checks', () => {
  const now = Date.UTC(2026, 9, 26);
  const exp = Math.floor(now / 1000) + 60;
  const expect_ = { issuer: 'https://auth.hoandat.com', clientId: 'lockin-web', nonce: 'n1' };
  const good = { iss: expect_.issuer, aud: 'lockin-web', exp, nonce: 'n1', sub: 'account-1' };

  it('returns the sub of a token meant for this client', () => {
    expect(subFromIdToken(token(good), expect_, now)).toBe('account-1');
    expect(subFromIdToken(token({ ...good, aud: ['other', 'lockin-web'] }), expect_, now)).toBe('account-1');
  });

  it.each([
    ['another issuer', { iss: 'https://evil.example' }],
    ['another audience', { aud: 'chat-web' }],
    ['an old nonce', { nonce: 'n0' }],
    ['an expired token', { exp: exp - 120 }],
    ['no sub', { sub: '' }],
  ])('rejects %s', (_label, change) => {
    expect(subFromIdToken(token({ ...good, ...change }), expect_, now)).toBeNull();
  });

  it('rejects what is not a JWT', () => {
    expect(subFromIdToken('garbage', expect_, now)).toBeNull();
    expect(subFromIdToken('a.!!!.c', expect_, now)).toBeNull();
  });
});

describe('userinfo profile', () => {
  it('keeps the name, an email-shaped email and an https picture of the signed-in account', () => {
    expect(profileFromUserinfo({ sub: 's1', name: ' Văn A ', email: 'a@example.com', picture: 'https://lh3.googleusercontent.com/a', telegram_linked: true }, 's1')).toEqual({
      name: 'Văn A',
      email: 'a@example.com',
      picture: 'https://lh3.googleusercontent.com/a',
    });
    expect(profileFromUserinfo({ sub: 's1', preferred_username: 'van-a', email: 'not-an-email', picture: 'javascript:alert(1)' }, 's1')).toEqual({
      name: 'van-a',
      email: null,
      picture: null,
    });
    expect(profileFromUserinfo({ sub: 's1', name: 'x'.repeat(201), picture: 'not a url' }, 's1')).toEqual({ name: null, email: null, picture: null });
  });

  it('ignores an answer about another account or not an object', () => {
    expect(profileFromUserinfo({ sub: 'other', name: 'B' }, 's1')).toBeNull();
    expect(profileFromUserinfo({ name: 'B' }, 's1')).toBeNull();
    expect(profileFromUserinfo(null, 's1')).toBeNull();
    expect(profileFromUserinfo('s1', 's1')).toBeNull();
  });
});
