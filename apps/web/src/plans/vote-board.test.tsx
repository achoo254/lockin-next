import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanView } from '../api/plans-api';
import { I18nProvider } from '../i18n/i18n';
import { P2, T1, TOKEN, makePlan, person, stubFetch } from '../test/plan-fixture';
import { VoteBoard } from './vote-board';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(plan: PlanView, mode: 'vote' | 'rsvp' = 'vote'): { onChange: ReturnType<typeof vi.fn>; onSent: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn();
  const onSent = vi.fn();
  render(
    <I18nProvider>
      <VoteBoard plan={plan} token={TOKEN} mode={mode} onChange={onChange} onSent={onSent} />
    </I18nProvider>,
  );
  return { onChange, onSent };
}

describe('the vote board', () => {
  it('lets a new guest join, vote for several options and say they join, with no sign-in', async () => {
    const joined = makePlan({ viewer: { isCreator: false, participantId: 'me' }, participants: [person('me', 'Linh')] });
    const api = stubFetch(() => ({ plan: joined }));
    try {
      const { onChange, onSent } = show(makePlan());
      expect(screen.getByLabelText('Tên bạn là gì?')).not.toBeNull();
      fireEvent.change(screen.getByLabelText('Tên bạn là gì?'), { target: { value: '  Linh ' } });
      const times = screen.getAllByRole('button', { pressed: false }).filter((b) => b.dataset.id?.startsWith('option-'));
      expect(times).toHaveLength(4);
      fireEvent.click(document.querySelector(`[data-id=option-${T1}]`) as HTMLElement);
      fireEvent.click(document.querySelector(`[data-id=option-${P2}]`) as HTMLElement);
      expect(document.querySelector(`[data-id=option-${T1}]`)?.getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'Có' }));
      fireEvent.click(screen.getByRole('button', { name: 'Gửi vote' }));
      await waitFor(() => expect(onSent).toHaveBeenCalled());
      expect(api.calls.map((call) => [call.method, call.path, call.body])).toEqual([
        ['POST', `/api/k/${TOKEN}/join`, { displayName: 'Linh' }],
        ['POST', `/api/k/${TOKEN}/votes`, { optionIds: [T1, P2] }],
        ['POST', `/api/k/${TOKEN}/rsvp`, { rsvp: 'going' }],
      ]);
      expect(onChange).toHaveBeenLastCalledWith(joined);
      expect(document.querySelector('[data-id=vote-sent]')).not.toBeNull();
    } finally {
      api.restore();
    }
  });

  it('puts "Mở bản đồ" beside every place, in a new tab', () => {
    show(makePlan());
    const links = screen.getAllByRole('link', { name: 'Mở bản đồ' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://www.google.com/maps/search/?api=1&query=Qu%C3%A1n%20c%C3%A0%20ph%C3%AA%20A%2C%20Qu%E1%BA%ADn%203',
      'https://maps.app.goo.gl/QuanB',
    ]);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('asks for a name and a pick before sending anything', () => {
    const api = stubFetch(() => ({}));
    try {
      show(makePlan());
      fireEvent.click(screen.getByRole('button', { name: 'Gửi vote' }));
      expect(screen.getByRole('alert').textContent).toBe('Nhập tên của bạn nhé.');
      fireEvent.change(screen.getByLabelText('Tên bạn là gì?'), { target: { value: 'Linh' } });
      fireEvent.click(screen.getByRole('button', { name: 'Gửi vote' }));
      expect(screen.getByRole('alert').textContent).toBe('Chọn ít nhất một giờ, một chỗ, hoặc cho biết bạn có đi không.');
      expect(api.calls).toEqual([]);
    } finally {
      api.restore();
    }
  });

  it('keeps a returning guest, sends only what changed, and says why a refusal happened', async () => {
    const me = person('me', 'Linh', [T1], 'going');
    const plan = makePlan({ viewer: { isCreator: false, participantId: 'me' }, participants: [me] });
    const api = stubFetch(() => Response.json({ error: 'deadline-passed' }, { status: 409 }));
    try {
      show(plan);
      expect((screen.getByLabelText('Tên bạn là gì?') as HTMLInputElement).value).toBe('Linh');
      expect(document.querySelector(`[data-id=option-${T1}]`)?.getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(document.querySelector(`[data-id=option-${P2}]`) as HTMLElement);
      fireEvent.click(screen.getByRole('button', { name: 'Gửi vote' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Đã hết giờ vote, chờ người tạo chốt kèo nhé.'));
      expect(api.calls.map((call) => call.path)).toEqual([`/api/k/${TOKEN}/votes`]);
    } finally {
      api.restore();
    }
  });

  it('only asks for the name and whether one joins once voting is over', () => {
    show(makePlan({ status: 'locked', can: { join: true, vote: false, rsvp: true, edit: false, lock: false, cancel: false, done: false, rotateLink: false } }), 'rsvp');
    expect(document.querySelector('[data-id^=option-]')).toBeNull();
    expect(screen.getByRole('group', { name: 'Bạn tham gia chứ?' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Gửi' })).not.toBeNull();
  });
});
