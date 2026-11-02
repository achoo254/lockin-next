import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type SessionState, loginReturnPath, safeReturnPath, signInHref, signUpHref } from '../api/session-api';
import { brand } from '../brand';
import { I18nProvider } from '../i18n/i18n';
import { LoginPage } from '../pages/login-page';
import { LockinPage } from './lockin-page';

function clearPreferences(): void {
  for (const name of ['hd_lang', 'hd_theme']) document.cookie = `${name}=; Max-Age=0; Path=/`;
  window.localStorage.clear();
}

beforeEach(clearPreferences);
afterEach(() => {
  cleanup();
  clearPreferences();
  window.history.replaceState(null, '', '/');
});

function show(path: string, session: SessionState): void {
  render(
    <I18nProvider>
      <LockinPage path={path} session={session}>
        <h1>Body</h1>
      </LockinPage>
    </I18nProvider>,
  );
}

const SIGNED_OUT: SessionState = { status: 'ready', signedIn: false, signInAvailable: true };

describe('sign-in links', () => {
  it('only comes back to a page of this site, never to the sign-in page', () => {
    expect(safeReturnPath('/new?x=1')).toBe('/new?x=1');
    for (const unsafe of ['https://evil.example', '//evil.example', '/\\evil', '', null, '/login', '/login?return=/x']) expect(safeReturnPath(unsafe)).toBe('/');
  });

  it('asks the IdP for its sign-up screen from sign-up links only, back to a page of this site', () => {
    expect(loginReturnPath('?return=%2Fnew')).toBe('/new');
    expect(loginReturnPath('?return=https%3A%2F%2Fevil.example')).toBe('/');
    expect(signInHref('en', '/credits')).toBe('/auth/login?return=%2Fcredits&lang=en');
    expect(signUpHref('vi', '/new')).toBe('/auth/login?return=%2Fnew&lang=vi&signup=1');
    expect(signUpHref('en', 'https://evil.example')).toBe('/auth/login?return=%2F&lang=en&signup=1');
  });
});

describe('page frame', () => {
  it("has the app's header: brand, language pill, sign-up pill, skip link", () => {
    show('/privacy', SIGNED_OUT);
    expect(document.querySelector('[data-id=public-header] [data-id=public-home]')?.textContent).toBe(brand.appName);
    // The pill is a sign-up button: straight to making an account at the IdP, back to this page.
    expect(document.querySelector('[data-id=public-sign-in]')?.getAttribute('href')).toBe('/auth/login?return=%2Fprivacy&lang=vi&signup=1');
    expect(document.querySelector('[data-id=public-sign-in] .hide-phone')?.textContent).toBe('Đăng ký miễn phí');
    expect(document.querySelector('[data-id=public-sign-in] .only-phone')?.textContent).toBe('Đăng ký');
    expect(document.querySelector('[data-id=lang-vi]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-id=skip-link]')?.getAttribute('href')).toBe('#main');
    expect(document.querySelector('main#main')).not.toBeNull();
  });

  it('says in the footer that the app belongs to hoandat.com, with the privacy, terms and credits pages', () => {
    show('/credits', SIGNED_OUT);
    const home = document.querySelector('[data-id=foot-home]');
    expect(home?.textContent).toBe('Một app của hoandat.com');
    expect(home?.getAttribute('href')).toBe('https://hoandat.com');
    expect(document.querySelector('[data-id=foot-privacy]')?.getAttribute('href')).toBe('/privacy');
    expect(document.querySelector('[data-id=foot-terms]')?.getAttribute('href')).toBe('/terms');
    expect(document.querySelector('[data-id=foot-credits]')?.getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('[data-id=foot-note]')?.textContent).toBe('Miễn phí, không quảng cáo.');
  });

  it('switches the language and keeps it in the shared cookie', () => {
    show('/', SIGNED_OUT);
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(document.querySelector('[data-id=foot-note]')?.textContent).toBe('Free, no ads.');
    expect(document.querySelector('[data-id=foot-home]')?.textContent).toBe('An app from hoandat.com');
    expect(document.querySelector('[data-id=lang-en]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.cookie).toContain('hd_lang=en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('opens in the language picked in another hoandat.com app', () => {
    document.cookie = 'hd_lang=en; Path=/';
    show('/', SIGNED_OUT);
    expect(document.querySelector('[data-id=foot-note]')?.textContent).toBe('Free, no ads.');
  });

  it('shows the account (picture and name) instead of sign-up once signed in, with its menu', () => {
    const user = { name: 'Nguyễn Văn A', email: 'a@example.com', picture: 'https://lh3.googleusercontent.com/a/photo' };
    show('/', { status: 'ready', signedIn: true, signInAvailable: true, user });
    expect(document.querySelector('[data-id=public-sign-in]')).toBeNull();
    const trigger = document.querySelector('[data-id=public-header] [data-id=topbar-account]');
    expect(trigger?.textContent).toContain('Nguyễn Văn A');
    expect(trigger?.querySelector('img')?.getAttribute('src')).toBe(user.picture);
    expect(document.querySelector('[data-id=account-menu]')?.textContent).toContain('a@example.com');
    expect(document.querySelector('[data-id=account-menu-sign-out]')?.textContent).toBe('Đăng xuất');
  });

  it('signs out from the account menu, then goes home', async () => {
    const calls: Array<[string, string | undefined]> = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push([String(input), init?.method]);
      return new Response(null, { status: 204 });
    });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    try {
      show('/', { status: 'ready', signedIn: true, signInAvailable: true, user: { name: 'A', email: null, picture: null } });
      fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
      expect(calls).toEqual([['/auth/logout', 'POST']]);
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('has no sign-up pill when sign-in is not configured', () => {
    show('/', { status: 'ready', signedIn: false, signInAvailable: false });
    expect(document.querySelector('[data-id=public-sign-in]')).toBeNull();
    expect(document.querySelector('[data-id=account-menu]')).toBeNull();
  });
});

describe('sign-in page', () => {
  it('has the sign-in card whose one link goes to the IdP and back to the page the visitor came from', () => {
    window.history.replaceState(null, '', '/login?return=%2Fnew');
    render(
      <I18nProvider>
        <LockinPage path="/login" session={SIGNED_OUT} layout="center">
          <LoginPage session={SIGNED_OUT} />
        </LockinPage>
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Đăng nhập để tạo kèo');
    expect(document.querySelector('[data-id=sign-in-cta]')?.getAttribute('href')).toBe('/auth/login?return=%2Fnew&lang=vi');
    expect(document.querySelector('[data-id=sign-in-cta]')?.textContent).toBe('Đăng nhập bằng hoandat.com');
    // The sign-up pill there goes back to the same page as the card.
    expect(document.querySelector('[data-id=public-sign-in]')?.getAttribute('href')).toBe('/auth/login?return=%2Fnew&lang=vi&signup=1');
  });
});
