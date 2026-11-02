import { describe, expect, it } from 'vitest';
import { translator } from '../i18n/i18n';
import { comingWeekdayAt, formatDong, formatLeft, formatVnDateTime, vnDayAt, vnInputs, vnInputsToDate } from './vn-time';

const t = translator('vi');

describe('Vietnam time', () => {
  it('reads and writes the inputs in Vietnam time, whatever the device zone', () => {
    // 2026-11-07 02:00 UTC is 09:00 on Saturday in Vietnam.
    const at = new Date('2026-11-07T02:00:00Z');
    expect(vnInputs(at)).toEqual({ date: '2026-11-07', time: '09:00' });
    expect(vnInputsToDate({ date: '2026-11-07', time: '09:00' })?.toISOString()).toBe('2026-11-07T02:00:00.000Z');
    // Late evening in Vietnam is still the previous day in UTC.
    expect(vnInputs(new Date('2026-11-06T17:30:00Z'))).toEqual({ date: '2026-11-07', time: '00:30' });
    expect(vnInputsToDate({ date: '2026-11-07', time: '' })).toBeNull();
    expect(vnInputsToDate({ date: 'x', time: '09:00' })).toBeNull();
  });

  it('shows times like the mockup', () => {
    expect(formatVnDateTime('2026-11-07T02:00:00Z', 'vi')).toBe('Thứ Bảy 07/11, 9:00');
    expect(formatVnDateTime('2026-11-08T08:00:00Z', 'en')).toBe('Sun 8 Nov, 15:00');
  });

  it('finds today and the coming weekend days', () => {
    const fridayNoon = new Date('2026-11-06T05:00:00Z'); // Friday 12:00 in Vietnam
    expect(vnDayAt(fridayNoon, 0, '19:00')?.toISOString()).toBe('2026-11-06T12:00:00.000Z');
    expect(comingWeekdayAt(fridayNoon, 6, '19:00')?.toISOString()).toBe('2026-11-07T12:00:00.000Z');
    expect(comingWeekdayAt(fridayNoon, 0, '19:00')?.toISOString()).toBe('2026-11-08T12:00:00.000Z');
    // Saturday after 19:00: "this Saturday" is next week's.
    const saturdayNight = new Date('2026-11-07T13:00:00Z');
    expect(comingWeekdayAt(saturdayNight, 6, '19:00')?.toISOString()).toBe('2026-11-14T12:00:00.000Z');
  });

  it('says how long is left, and money in dong', () => {
    const now = new Date('2026-11-02T08:00:00Z');
    expect(formatLeft(new Date(now.getTime() + 5 * 3600_000 + 60_000), now, t)).toBe('5 giờ');
    expect(formatLeft(new Date(now.getTime() + 20 * 60_000), now, t)).toBe('20 phút');
    expect(formatLeft(new Date(now.getTime() + 3 * 86_400_000), now, t)).toBe('3 ngày');
    expect(formatLeft(now, now, t)).toBeNull();
    expect(formatDong(60000, 'vi')).toBe('60.000đ');
    expect(formatDong(60000, 'en')).toBe('60,000₫');
  });
});
