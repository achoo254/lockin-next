import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, translator } from '../i18n/i18n';
import { PLAN_ID, type Call, creatorPlan, stubFetch } from '../test/plan-fixture';
import { type CreateForm, PlanForm, buildCreateInput, deadlineAt, initialForm, placeInput, quickTimeAt } from './plan-form';
import { mapHref } from './plan-format';

const t = translator('vi');
/** Friday 2026-11-06, 10:00 in Vietnam. */
const NOW = new Date('2026-11-06T03:00:00Z');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function form(overrides: Partial<CreateForm> = {}): CreateForm {
  return { ...initialForm(NOW, 'Minh', t), ...overrides };
}

describe('buildCreateInput', () => {
  it('starts as coffee with this weekend at 19:00, 24 hours to vote and the account name', () => {
    const start = form();
    expect(start.title).toBe('Cà phê cuối tuần');
    expect(start.times.map((row) => [row.date, row.time, row.quick])).toEqual([
      ['2026-11-07', '19:00', 'sat'],
      ['2026-11-08', '19:00', 'sun'],
    ]);
    const built = buildCreateInput({ ...start, places: [{ key: 'p', label: ' Quán A ', mapUrl: null }], area: ' Quận 3 ', budget: '60000', groupSize: '6' }, NOW);
    expect(built).toEqual({
      ok: true,
      input: {
        title: 'Cà phê cuối tuần',
        activity: 'coffee',
        area: 'Quận 3',
        budgetPerPerson: 60000,
        groupSize: 6,
        voteDeadline: new Date(NOW.getTime() + 24 * 3600_000).toISOString(),
        options: [
          { kind: 'time', startsAt: '2026-11-07T12:00:00.000Z' },
          { kind: 'time', startsAt: '2026-11-08T12:00:00.000Z' },
          { kind: 'place', label: 'Quán A' },
        ],
        creatorDisplayName: 'Minh',
      },
    });
  });

  it('leaves out empty rows and optional fields, and the name when cleared', () => {
    const built = buildCreateInput(form({ name: '  ', places: [{ key: 'p', label: '', mapUrl: null }] }), NOW);
    expect(built.ok && built.input).toEqual(expect.not.objectContaining({ creatorDisplayName: expect.anything(), area: expect.anything(), groupSize: expect.anything() }));
    expect(built.ok && built.input.options).toHaveLength(2);
  });

  it('names the first problem', () => {
    expect(buildCreateInput(form({ title: '  ' }), NOW)).toEqual({ ok: false, error: 'form.error.title' });
    expect(buildCreateInput(form({ times: [], places: [] }), NOW)).toEqual({ ok: false, error: 'form.error.noOption' });
    expect(buildCreateInput(form({ times: [{ key: 'a', date: '2026-11-07', time: '', quick: null }] }), NOW)).toEqual({ ok: false, error: 'form.error.timeIncomplete', n: 1 });
    expect(buildCreateInput(form({ times: [{ key: 'a', date: '2026-11-05', time: '09:00', quick: null }] }), NOW)).toEqual({ ok: false, error: 'form.error.timePast', n: 1 });
    expect(buildCreateInput(form({ budget: '200000000' }), NOW)).toEqual({ ok: false, error: 'form.error.budget' });
    expect(buildCreateInput(form({ groupSize: '1' }), NOW)).toEqual({ ok: false, error: 'form.error.groupSize' });
    expect(buildCreateInput(form({ groupSize: '51' }), NOW)).toEqual({ ok: false, error: 'form.error.groupSize' });
    expect(buildCreateInput(form({ deadline: 'custom', deadlineDate: '', deadlineTime: '' }), NOW)).toEqual({ ok: false, error: 'form.error.deadlineIncomplete' });
    expect(buildCreateInput(form({ deadline: 'custom', deadlineDate: '2027-03-01', deadlineTime: '10:00' }), NOW)).toEqual({ ok: false, error: 'form.error.deadline' });
  });

  it('knows when the quick times and deadlines fall, and which have passed', () => {
    expect(quickTimeAt('noon', NOW)?.toISOString()).toBe('2026-11-06T05:00:00.000Z');
    expect(quickTimeAt('tonight', NOW)?.toISOString()).toBe('2026-11-06T12:00:00.000Z');
    const evening = new Date('2026-11-06T13:00:00Z'); // 20:00
    expect(quickTimeAt('noon', evening)).toBeNull();
    expect(quickTimeAt('tonight', evening)).toBeNull();
    expect(deadlineAt({ deadline: '3h', deadlineDate: '', deadlineTime: '' }, NOW)?.toISOString()).toBe('2026-11-06T06:00:00.000Z');
    expect(deadlineAt({ deadline: 'tonight', deadlineDate: '', deadlineTime: '' }, NOW)?.toISOString()).toBe('2026-11-06T15:00:00.000Z');
    expect(deadlineAt({ deadline: 'tonight', deadlineDate: '', deadlineTime: '' }, new Date('2026-11-06T15:30:00Z'))).toBeNull();
  });
});

describe('places with a map link', () => {
  const empty = { key: 'p', label: '', mapUrl: null };

  it('attaches a pasted Google Maps link and pre-fills the name from a place link', () => {
    const place = 'https://www.google.com/maps/place/C%E1%BB%99ng+C%C3%A0+Ph%C3%AA/@10.77,106.69,17z';
    expect(placeInput(empty, place)).toEqual({ key: 'p', label: 'Cộng Cà Phê', mapUrl: place });
    // A short link tells no name: the name stays to be typed, then the link stays attached.
    const short = placeInput(empty, 'https://maps.app.goo.gl/AbC');
    expect(short).toEqual({ key: 'p', label: '', mapUrl: 'https://maps.app.goo.gl/AbC' });
    expect(placeInput(short, 'Quán B')).toEqual({ key: 'p', label: 'Quán B', mapUrl: 'https://maps.app.goo.gl/AbC' });
    // Other links are plain text.
    expect(placeInput(empty, 'javascript:alert(1)')).toEqual({ ...empty, label: 'javascript:alert(1)' });
    expect(placeInput(empty, 'http://maps.app.goo.gl/AbC').mapUrl).toBeNull();
  });

  it('asks for a name before sending a place that only has a link, and sends the link with it', () => {
    const linked = { key: 'p', label: '', mapUrl: 'https://maps.app.goo.gl/AbC' };
    expect(buildCreateInput(form({ places: [linked] }), NOW)).toEqual({ ok: false, error: 'form.error.placeLabel', n: 1 });
    const built = buildCreateInput(form({ times: [], places: [{ ...linked, label: 'Quán B' }] }), NOW);
    expect(built.ok && built.input.options).toEqual([{ kind: 'place', label: 'Quán B', mapUrl: 'https://maps.app.goo.gl/AbC' }]);
  });

  it('opens the attached link, else a Google Maps search with the area, diacritics encoded', () => {
    expect(mapHref({ label: 'Quán B', mapUrl: 'https://maps.app.goo.gl/AbC' }, 'Quận 3')).toBe('https://maps.app.goo.gl/AbC');
    expect(mapHref({ label: 'Quán cà phê A', mapUrl: null }, 'Quận 3')).toBe('https://www.google.com/maps/search/?api=1&query=Qu%C3%A1n%20c%C3%A0%20ph%C3%AA%20A%2C%20Qu%E1%BA%ADn%203');
  });
});

describe('the create form', () => {
  function show(onCreated = vi.fn()): ReturnType<typeof vi.fn> {
    render(
      <I18nProvider>
        <PlanForm defaultName="Minh" now={() => NOW} onCreated={onCreated} />
      </I18nProvider>,
    );
    return onCreated;
  }

  it('fills the title from the kind, adds quick times, and sends the plan with the creator name and group size', async () => {
    const api = stubFetch(() => Response.json({ plan: creatorPlan(), share: { token: 'x', url: 'https://x/k/x' } }, { status: 201 }));
    try {
      const onCreated = show();
      fireEvent.click(screen.getByRole('button', { name: '🍱 Ăn trưa' }));
      expect((document.querySelector('[data-id=form-title]') as HTMLInputElement).value).toBe('Ăn trưa cả team');
      expect(screen.getByRole('button', { name: '🍱 Ăn trưa' }).getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'Trưa nay 12:00' }));
      fireEvent.click(screen.getByRole('button', { name: 'CN này' })); // unpick Sunday
      fireEvent.change(document.querySelector('[data-id=place-0]') as HTMLInputElement, { target: { value: 'Cơm tấm Cali' } });
      fireEvent.change(document.querySelector('[data-id=form-budget]') as HTMLInputElement, { target: { value: '80.000' } });
      fireEvent.change(document.querySelector('[data-id=form-group-size]') as HTMLInputElement, { target: { value: '9' } });
      fireEvent.click(screen.getByRole('button', { name: '3 tiếng' }));
      expect((document.querySelector('[data-id=form-budget]') as HTMLInputElement).value).toBe('80.000');
      fireEvent.click(screen.getByRole('button', { name: 'Lên kèo & lấy link' }));
      await waitFor(() => expect(onCreated).toHaveBeenCalledWith(creatorPlan().id));
      const [call] = api.calls as [Call];
      expect(call.path).toBe('/api/plans');
      expect(call.method).toBe('POST');
      expect(call.body).toEqual({
        title: 'Ăn trưa cả team',
        activity: 'lunch',
        budgetPerPerson: 80000,
        groupSize: 9,
        voteDeadline: '2026-11-06T06:00:00.000Z',
        options: [
          { kind: 'time', startsAt: '2026-11-07T12:00:00.000Z' },
          { kind: 'time', startsAt: '2026-11-06T05:00:00.000Z' },
          { kind: 'place', label: 'Cơm tấm Cali' },
        ],
        creatorDisplayName: 'Minh',
      });
    } finally {
      api.restore();
    }
  });

  it('says what to fix instead of sending, and shows the API refusal in words', async () => {
    const api = stubFetch(() => Response.json({ error: 'rate-limited' }, { status: 429 }));
    try {
      const onCreated = show();
      fireEvent.change(document.querySelector('[data-id=form-title]') as HTMLInputElement, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lên kèo & lấy link' }));
      expect(screen.getByRole('alert').textContent).toBe('Đặt tên cho kèo nhé.');
      expect(api.calls).toEqual([]);
      fireEvent.change(document.querySelector('[data-id=form-title]') as HTMLInputElement, { target: { value: 'Kèo' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lên kèo & lấy link' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Bạn thao tác hơi nhanh. Đợi một lát rồi thử lại nhé.'));
      expect(onCreated).not.toHaveBeenCalled();
      expect(PLAN_ID).toBeTruthy();
    } finally {
      api.restore();
    }
  });
});
