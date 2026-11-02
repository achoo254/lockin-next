import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanView } from '../api/plans-api';
import { I18nProvider } from '../i18n/i18n';
import { P1, P2, PLAN_ID, T1, T2, creatorPlan, makePlan, person, stubFetch } from '../test/plan-fixture';
import { LockPanel } from './lock-panel';
import { goingNames, kindLeader, nudgeLine } from './plan-format';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(plan: PlanView): { onChange: ReturnType<typeof vi.fn>; onRotated: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn();
  const onRotated = vi.fn();
  render(
    <I18nProvider>
      <LockPanel plan={plan} onChange={onChange} onRotated={onRotated} />
    </I18nProvider>,
  );
  return { onChange, onRotated };
}

const radio = (id: string): HTMLElement => document.querySelector(`[data-id=option-${id}]`) as HTMLElement;

describe('locking a plan in', () => {
  it('finds the leader of a kind, or a tie the creator must settle', () => {
    const plan = makePlan();
    expect(kindLeader(plan.options.filter((o) => o.kind === 'time'))).toEqual({ leaderId: T1, tie: [] });
    expect(kindLeader(plan.options.filter((o) => o.kind === 'place'))).toEqual({ leaderId: null, tie: [3, 3] });
    expect(kindLeader([{ ...plan.options[0], votes: 0 } as PlanView['options'][number]])).toEqual({ leaderId: null, tie: [] });
  });

  it('lists the creator first among the going, without counting their going as a vote', () => {
    // The server makes the creator going when the plan is made; they have not voted yet.
    const plan = makePlan({ groupSize: 4, participants: [person('g1', 'Linh', [T1], 'going'), person('me', 'Minh', [], 'going', true), person('g2', 'Tú', [T2], 'no')] });
    expect(goingNames(plan)).toEqual(['Minh', 'Linh']);
    expect(nudgeLine(plan)).toEqual({ kind: 'left', k: 2 });
    // Once the creator says no, they leave the going list; the votes are the same.
    const declined = makePlan({ groupSize: 4, participants: plan.participants.map((p) => (p.isCreator ? { ...p, rsvp: 'no' as const } : p)) });
    expect(goingNames(declined)).toEqual(['Linh']);
    expect(nudgeLine(declined)).toEqual({ kind: 'left', k: 2 });
  });

  it('pre-picks the time with most votes, waits for the creator on a tied place, then locks both', async () => {
    const plan = creatorPlan({
      groupSize: 6,
      participants: [person('a', 'Linh', [T1, P1], 'going'), person('b', 'Vy', [T2], 'no')],
    });
    const locked = creatorPlan({ status: 'locked', lockedOptionIds: [T1, P2] });
    const api = stubFetch(() => ({ plan: locked }));
    try {
      const { onChange } = show(plan);
      expect(document.querySelector('[data-id=lock-panel]')?.textContent).toContain('2/6 người đã vote');
      expect(document.querySelector('[data-id=lock-panel]')?.textContent).toContain('Vy · không tham gia');
      expect(radio(T1).getAttribute('aria-checked')).toBe('true');
      expect(radio(T1).textContent).toContain('Nhiều phiếu nhất');
      expect(radio(P1).getAttribute('aria-checked')).toBe('false');
      expect(radio(P2).getAttribute('aria-checked')).toBe('false');
      expect(screen.getByText('Hoà 3–3')).not.toBeNull();
      const submit = screen.getByRole('button', { name: 'Chốt kèo!' });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(radio(P2));
      expect(radio(P2).textContent).toContain('Bạn chọn');
      expect((submit as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(submit);
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(locked));
      expect(api.calls).toEqual([{ path: `/api/plans/${PLAN_ID}/lock`, method: 'POST', body: { timeOptionId: T1, placeOptionId: P2 } }]);
    } finally {
      api.restore();
    }
  });

  it('changes the link and cancels only after a confirm', async () => {
    const cancelled = creatorPlan({ status: 'cancelled' });
    const api = stubFetch((call) => (call.path.endsWith('/rotate-link') ? { share: { token: 'n', url: 'https://x/k/n' } } : { plan: cancelled }));
    try {
      const { onChange, onRotated } = show(creatorPlan());
      fireEvent.click(screen.getByRole('button', { name: 'Đổi link' }));
      expect(api.calls).toEqual([]);
      expect(screen.getByText('Link cũ sẽ ngừng chạy ngay. Đổi link?')).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Đồng ý' }));
      await waitFor(() => expect(onRotated).toHaveBeenCalled());
      fireEvent.click(screen.getByRole('button', { name: 'Huỷ kèo' }));
      fireEvent.click(screen.getByRole('button', { name: 'Thôi' }));
      fireEvent.click(screen.getByRole('button', { name: 'Huỷ kèo' }));
      fireEvent.click(screen.getByRole('button', { name: 'Đồng ý' }));
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(cancelled));
      expect(api.calls.map((call) => call.path)).toEqual([`/api/plans/${PLAN_ID}/rotate-link`, `/api/plans/${PLAN_ID}/cancel`]);
    } finally {
      api.restore();
    }
  });

  it('shows the API refusal in words', async () => {
    const api = stubFetch(() => Response.json({ error: 'plan-not-open' }, { status: 409 }));
    try {
      show(creatorPlan({ options: makePlan().options.map((o) => ({ ...o, votes: o.id === P1 ? 4 : o.votes })) }));
      fireEvent.click(screen.getByRole('button', { name: 'Chốt kèo!' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Kèo không còn mở để vote hay chốt.'));
    } finally {
      api.restore();
    }
  });
});
