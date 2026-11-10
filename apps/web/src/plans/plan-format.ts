/** Pure helpers of the plan screens: option labels, map links, vote counts, the leader of a kind, the nudge. */
import type { PlanOption, PlanView } from '../api/plans-api';
// One check of map links on both sides: the server refuses what this would not send.
import { mapsSearchUrl } from '../../../server/src/plans/map-link';
import type { Locale } from '../i18n/i18n';
import { formatVnDateTime } from './vn-time';

/** An http(s) link someone pasted as a place. */
export function isLink(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/** What a place link shows instead of the whole URL: its host ("maps.app.goo.gl"). */
function linkHost(text: string): string {
  try {
    return new URL(text.trim()).host;
  } catch {
    return text;
  }
}

/** "Thứ Bảy 07/11, 9:00 · sau giờ làm" for a time, the place name (or the host of its link) for a place. */
export function optionText(option: PlanOption, locale: Locale): string {
  if (option.kind === 'time' && option.startsAt) {
    const when = formatVnDateTime(option.startsAt, locale);
    return option.label ? `${when} · ${option.label}` : when;
  }
  return isLink(option.label) ? linkHost(option.label) : option.label;
}

/** Where "Mở bản đồ" goes: the place's pasted map link, else a keyless Google Maps search for the place and area. */
export function mapHref(place: Pick<PlanOption, 'label' | 'mapUrl'>, area: string | null): string {
  if (place.mapUrl) return place.mapUrl;
  return mapsSearchUrl(place.label, area);
}

export const optionsOf = (plan: PlanView, kind: PlanOption['kind']): PlanOption[] => plan.options.filter((option) => option.kind === kind);

/** People who have answered: picked at least one option, or said they are not going. */
export function voterCount(plan: PlanView): number {
  return plan.participants.filter((person) => person.optionIds.length > 0 || person.rsvp === 'no').length;
}

export interface KindLeader {
  /** The one option with the most votes; null on a tie at the top or when nobody voted. */
  leaderId: string | null;
  /** Vote counts of the options tied at the top (two or more), else empty. */
  tie: number[];
}

/** Who leads among the options of one kind: the creator picks on a tie, the app never does. */
export function kindLeader(options: PlanOption[]): KindLeader {
  const top = Math.max(0, ...options.map((option) => option.votes));
  if (top === 0) return { leaderId: null, tie: [] };
  const leaders = options.filter((option) => option.votes === top);
  if (leaders.length === 1) return { leaderId: leaders[0]?.id ?? null, tie: [] };
  return { leaderId: null, tie: leaders.map((option) => option.votes) };
}

/** The nudge line: how many voted, or how many of the expected group have not yet. */
export type NudgeLine = { kind: 'voted'; n: number } | { kind: 'left'; k: number } | { kind: 'all' };

export function nudgeLine(plan: PlanView): NudgeLine {
  const voted = voterCount(plan);
  if (plan.groupSize === null) return { kind: 'voted', n: voted };
  const left = plan.groupSize - voted;
  return left > 0 ? { kind: 'left', k: left } : { kind: 'all' };
}

/** The options the plan was locked in on, in time-then-place order. */
export function lockedOptions(plan: PlanView): { time: PlanOption | null; place: PlanOption | null } {
  const locked = plan.options.filter((option) => plan.lockedOptionIds.includes(option.id));
  return { time: locked.find((option) => option.kind === 'time') ?? null, place: locked.find((option) => option.kind === 'place') ?? null };
}

/** The names of the people going (the creator first when going). */
export function goingNames(plan: PlanView): string[] {
  const going = plan.participants.filter((person) => person.rsvp === 'going');
  return [...going.filter((person) => person.isCreator), ...going.filter((person) => !person.isCreator)].map((person) => person.displayName);
}
