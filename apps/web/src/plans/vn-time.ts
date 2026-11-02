/**
 * Times in Vietnam (Asia/Ho_Chi_Minh, UTC+7 all year, no daylight saving), whatever the device's own zone: what
 * people type in the date and time inputs, and how plans show their times. The API speaks UTC ISO strings.
 */
import type { Locale, Translate } from '../i18n/i18n';

export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A date input's value (yyyy-mm-dd) and a time input's value (hh:mm), in Vietnam time. */
export interface VnInputs {
  date: string;
  time: string;
}

/** The Vietnam wall-clock inputs of an instant. */
export function vnInputs(at: Date): VnInputs {
  const shifted = new Date(at.getTime() + VN_OFFSET_MS).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

/** The instant of Vietnam inputs, or null when either is empty or malformed. */
export function vnInputsToDate({ date, time }: VnInputs): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const at = new Date(`${date}T${time}:00+07:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Day of the week of a Vietnam date (0 = Sunday). */
function vnWeekday(at: Date): number {
  return new Date(at.getTime() + VN_OFFSET_MS).getUTCDay();
}

/** Vietnam date `days` after the Vietnam date of `at`, at `time`. */
export function vnDayAt(at: Date, days: number, time: string): Date | null {
  const start = vnInputsToDate({ date: vnInputs(at).date, time: '00:00' });
  if (!start) return null;
  return vnInputsToDate({ date: vnInputs(new Date(start.getTime() + days * DAY)).date, time });
}

/**
 * The coming `weekday` (0 = Sunday … 6 = Saturday) at `time`: today when it is that day and the time is still ahead,
 * otherwise the next one.
 */
export function comingWeekdayAt(now: Date, weekday: number, time: string): Date | null {
  const ahead = (weekday - vnWeekday(now) + 7) % 7;
  const today = vnDayAt(now, ahead, time);
  if (today && today.getTime() > now.getTime()) return today;
  return vnDayAt(now, ahead + 7, time);
}

/** "Thứ Bảy 07/11, 9:00" (vi) or "Sat 7 Nov, 9:00" (en), in Vietnam time. */
export function formatVnDateTime(iso: string | Date, locale: Locale): string {
  const at = typeof iso === 'string' ? new Date(iso) : iso;
  const part = (options: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', { timeZone: VN_TIME_ZONE, ...options }).format(at);
  const { date, time } = vnInputs(at);
  const [, month = '', day = ''] = date.split('-');
  const clock = `${Number(time.slice(0, 2))}:${time.slice(3, 5)}`;
  if (locale === 'vi') {
    const weekday = part({ weekday: 'long' });
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${day}/${month}, ${clock}`;
  }
  return `${part({ weekday: 'short' })} ${Number(day)} ${part({ month: 'short' })}, ${clock}`;
}

/** How long until `deadline`, rounded down to minutes, hours or days ("5 giờ"); null once it has passed. */
export function formatLeft(deadline: Date, now: Date, t: Translate): string | null {
  const left = deadline.getTime() - now.getTime();
  if (left <= 0) return null;
  if (left < HOUR) return t('time.minutes', { n: Math.max(1, Math.floor(left / MINUTE)) });
  if (left < 2 * DAY) return t('time.hours', { n: Math.floor(left / HOUR) });
  return t('time.days', { n: Math.floor(left / DAY) });
}

/** Amount of dong as "60.000đ" (vi) or "60,000₫" (en). */
export function formatDong(amount: number, locale: Locale): string {
  return locale === 'vi' ? `${amount.toLocaleString('vi-VN')}đ` : `${amount.toLocaleString('en-US')}₫`;
}
