import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../api/session-api';
import { App, isPlanLink, routePath } from '../app';
import { I18nProvider, translator } from '../i18n/i18n';
import { HomePage, createPlanHref, loginNotice } from './home-page';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
  document.cookie = 'hd_lang=; Max-Age=0; Path=/';
});

function showHome(session: SessionState): void {
  render(
    <I18nProvider>
      <HomePage session={session} />
    </I18nProvider>,
  );
}

const SIGNED_OUT: SessionState = { status: 'ready', signedIn: false, signInAvailable: true };
const SIGNED_IN: SessionState = { status: 'ready', signedIn: true, signInAvailable: true, user: { name: 'A', email: null, picture: null } };

describe('home page', () => {
  it('says what the app does and shows a friends and a work sample', () => {
    showHome(SIGNED_OUT);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Hết cảnh “để mai tính”.');
    const sample = document.querySelector('[data-id=sample-plan]');
    expect(sample?.getAttribute('aria-label')).toBe('Kèo mẫu');
    expect(sample?.textContent).toContain('Cà phê thứ Bảy');
    expect(document.querySelector('[data-id=sample-work]')?.textContent).toContain('Ăn trưa cả team');
    expect([...document.querySelectorAll('[data-id^=step-]')].map((step) => step.textContent)).toEqual(['1Lên kèo', '2Gửi link', '3Vote', '4Chốt!']);
  });

  it('sends a guest through sign-in to making a plan, and a signed-in person straight there', () => {
    showHome(SIGNED_OUT);
    expect(screen.getByRole('link', { name: 'Lên kèo' }).getAttribute('href')).toBe('/auth/login?return=%2Fnew&lang=vi');
    expect(document.querySelector('[data-id=home-my-plans]')).toBeNull();
    cleanup();
    showHome(SIGNED_IN);
    expect(screen.getByRole('link', { name: 'Lên kèo' }).getAttribute('href')).toBe('/new');
    expect(document.querySelector('[data-id=home-my-plans]')?.getAttribute('href')).toBe('/plans');
    expect(createPlanHref({ status: 'loading' }, 'en')).toBe('/auth/login?return=%2Fnew&lang=en');
  });

  it('shows the English value line', () => {
    document.cookie = 'hd_lang=en; Path=/';
    showHome(SIGNED_OUT);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('No more “let’s decide tomorrow”.');
  });

  it('says what happened on the way back from sign-in', () => {
    const t = translator('vi');
    expect(loginNotice('?login=fail', t)).toBe('Đăng nhập chưa thành công. Thử lại nhé.');
    expect(loginNotice('?login=busy', t)).toContain('quá nhiều');
    expect(loginNotice('?login=other', t)).toBeNull();
    window.history.replaceState(null, '', '/?login=unavailable');
    showHome(SIGNED_OUT);
    expect(document.querySelector('[data-id=login-notice]')?.textContent).toBe(t('login.unavailable'));
  });
});

describe('routes', () => {
  it('normalises paths and recognises plan links', () => {
    expect(routePath('/new/')).toBe('/new');
    expect(routePath('/')).toBe('/');
    expect(isPlanLink('/k/abc_DEF-123')).toBe(true);
    expect(isPlanLink('/k/')).toBe(false);
    expect(isPlanLink('/k/a/b')).toBe(false);
  });

  it.each([
    ['/new', 'sign-in-card'],
    ['/plans', 'sign-in-card'],
    ['/plans/0b6f2a52-9a7e-4c51-8a35-2d7d1f0c9a11', 'sign-in-card'],
    ['/k/abc123', 'state-loading'],
    ['/nope', 'not-found'],
  ])('shows %s as %s', async (path, dataId) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ signedIn: false, signInAvailable: true }));
    render(
      <I18nProvider>
        <App pathname={path} />
      </I18nProvider>,
    );
    await waitFor(() => expect(document.querySelector(`[data-id=${dataId}]`)).not.toBeNull());
  });
});
