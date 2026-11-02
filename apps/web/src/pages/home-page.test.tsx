import { cleanup, render, screen } from '@testing-library/react';
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
  it('says what the app does and shows a sample plan', () => {
    showHome(SIGNED_OUT);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Chốt kèo với nhóm bạn bằng một link');
    const sample = document.querySelector('[data-id=sample-plan]');
    expect(sample?.getAttribute('aria-label')).toBe('Ví dụ một kèo');
    expect(sample?.textContent).toContain('Cà phê cuối tuần');
    expect(sample?.textContent).toContain('Đã chốt');
    expect(document.querySelectorAll('[data-id^=step-]')).toHaveLength(3);
  });

  it('sends a guest through sign-in to making a plan, and a signed-in person straight there', () => {
    showHome(SIGNED_OUT);
    expect(screen.getByRole('link', { name: 'Tạo kèo' }).getAttribute('href')).toBe('/auth/login?return=%2Fnew&lang=vi');
    cleanup();
    showHome(SIGNED_IN);
    expect(screen.getByRole('link', { name: 'Tạo kèo' }).getAttribute('href')).toBe('/new');
    expect(createPlanHref({ status: 'loading' }, 'en')).toBe('/auth/login?return=%2Fnew&lang=en');
  });

  it('shows the English value line', () => {
    document.cookie = 'hd_lang=en; Path=/';
    showHome(SIGNED_OUT);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Lock in plans with your friends through one link');
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
    ['/new', 'coming-soon-new'],
    ['/k/abc123', 'coming-soon-plan'],
    ['/nope', 'not-found'],
  ])('shows %s as %s', (path, dataId) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ signedIn: false, signInAvailable: true }));
    render(
      <I18nProvider>
        <App pathname={path} />
      </I18nProvider>,
    );
    expect(document.querySelector(`[data-id=${dataId}]`)).not.toBeNull();
  });
});
