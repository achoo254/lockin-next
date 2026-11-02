import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanView } from '../api/plans-api';
import type { SessionState } from '../api/session-api';
import { I18nProvider } from '../i18n/i18n';
import { PLAN_ID, creatorPlan, stubFetch } from '../test/plan-fixture';
import { ManageLinkCard, SavePlanCard, claimParam, claimReturnPath } from './save-plan';

const SIGNED_OUT: SessionState = { status: 'ready', signedIn: false, signInAvailable: true };
const SIGNED_IN: SessionState = { status: 'ready', signedIn: true, signInAvailable: true, user: { name: 'A', email: null, picture: null } };
const MANAGE = { url: `https://lockin.hoandat.com/m/${PLAN_ID}.${'M'.repeat(43)}` };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function show(plan: PlanView, session: SessionState, variant: 'full' | 'locked', onSaved = vi.fn()): ReturnType<typeof vi.fn> {
  render(
    <I18nProvider>
      <SavePlanCard plan={plan} session={session} returnPath={`/plans/${PLAN_ID}`} variant={variant} onSaved={onSaved} />
    </I18nProvider>,
  );
  return onSaved;
}

describe('saving a plan to an account', () => {
  it('reads and writes the claim parameter, only for a plan id', () => {
    expect(claimReturnPath('/k/abc', PLAN_ID)).toBe(`/k/abc?claim=${PLAN_ID}`);
    expect(claimParam(`?claim=${PLAN_ID}`)).toBe(PLAN_ID);
    expect(claimParam('?claim=../evil')).toBeNull();
    expect(claimParam('')).toBeNull();
  });

  it('shows a signed-out creator the manage link to copy, the warning and sign-up back to saving it', () => {
    show(creatorPlan({ savedToAccount: false, manage: MANAGE }), SIGNED_OUT, 'full');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Giữ quyền quản lý kèo');
    expect(document.querySelector('[data-id=manage-url]')?.textContent).toBe(MANAGE.url.replace('https://', ''));
    expect(screen.getByRole('button', { name: 'Chép link quản lý' })).toBeTruthy();
    expect(document.querySelector('[data-id=manage-warn]')?.textContent).toBe('Ai có link này là quản lý được kèo, đừng gửi vào nhóm nhé.');
    const cta = screen.getByRole('link', { name: 'Lưu kèo vào tài khoản hoandat.com (miễn phí)' });
    expect(cta.getAttribute('href')).toBe(`/auth/login?return=%2Fplans%2F${PLAN_ID}%3Fclaim%3D${PLAN_ID}&lang=vi&signup=1`);
    expect(document.querySelector('[data-id=save-sign-in]')?.getAttribute('href')).toBe(`/auth/login?return=%2Fplans%2F${PLAN_ID}%3Fclaim%3D${PLAN_ID}&lang=vi`);
  });

  it('saves at once for someone signed in, and shows nothing once saved or to guests', async () => {
    const saved = creatorPlan({ savedToAccount: true, manage: MANAGE });
    const api = stubFetch(() => ({ plan: saved }));
    const onSaved = show(creatorPlan({ savedToAccount: false, manage: MANAGE }), SIGNED_IN, 'full');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu kèo vào tài khoản hoandat.com (miễn phí)' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(api.calls.map((c) => [c.method, c.path])).toEqual([['POST', `/api/plans/${PLAN_ID}/claim`]]);
    cleanup();
    show(saved, SIGNED_IN, 'full');
    expect(document.querySelector('[data-id=save-card]')).toBeNull();
    show(creatorPlan({ savedToAccount: false, viewer: { isCreator: false, participantId: null } }), SIGNED_OUT, 'full');
    expect(document.querySelector('[data-id=save-card]')).toBeNull();
  });

  it('offers it once under the locked ticket', () => {
    const plan = creatorPlan({ status: 'locked', savedToAccount: false, manage: MANAGE });
    show(plan, SIGNED_OUT, 'locked');
    expect(document.querySelector('[data-id=save-card-locked]')?.textContent).toContain('Chốt xong rồi!');
    cleanup();
    show(plan, SIGNED_OUT, 'locked');
    expect(document.querySelector('[data-id=save-card-locked]')).toBeNull();
  });

  it('changes the manage link: the new link replaces the old one on the card, with a notice', async () => {
    const fresh = { url: `https://lockin.hoandat.com/m/${PLAN_ID}.${'N'.repeat(43)}` };
    const api = stubFetch(() => ({ manage: fresh }));
    const onSaved = show(creatorPlan({ savedToAccount: false, manage: MANAGE }), SIGNED_OUT, 'full');
    expect(document.querySelector('[data-id=manage-rotate-note]')?.textContent).toContain('link cũ hết dùng ngay');
    fireEvent.click(screen.getByRole('button', { name: 'Đổi link quản lý' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ manage: fresh })));
    expect(api.calls.map((c) => [c.method, c.path])).toEqual([['POST', `/api/plans/${PLAN_ID}/rotate-manage`]]);
    expect(screen.getByRole('status').textContent).toBe('Đã đổi link quản lý. Link cũ không dùng được nữa, nhớ chép link mới.');
  });

  it('shows the owner of a saved plan its manage link and the way to change it, nobody else', () => {
    const onRotated = vi.fn();
    const renderCard = (plan: PlanView): void => {
      render(
        <I18nProvider>
          <ManageLinkCard plan={plan} onRotated={onRotated} />
        </I18nProvider>,
      );
    };
    renderCard(creatorPlan({ savedToAccount: true, manage: MANAGE }));
    expect(document.querySelector('[data-id=manage-card] h2')?.textContent).toBe('Link quản lý');
    expect(document.querySelector('[data-id=manage-url]')?.textContent).toBe(MANAGE.url.replace('https://', ''));
    expect(document.querySelector('[data-id=manage-warn]')?.textContent).toContain('chỉ tài khoản này quản lý được kèo');
    expect(screen.getByRole('button', { name: 'Đổi link quản lý' })).toBeTruthy();
    cleanup();
    // Not saved yet (the save card shows it), no link (made signed in), or not the creator: nothing.
    renderCard(creatorPlan({ savedToAccount: false, manage: MANAGE }));
    renderCard(creatorPlan({ savedToAccount: true, manage: null }));
    renderCard(creatorPlan({ savedToAccount: true, manage: MANAGE, viewer: { isCreator: false, participantId: null } }));
    expect(document.querySelector('[data-id=manage-card]')).toBeNull();
  });
});
