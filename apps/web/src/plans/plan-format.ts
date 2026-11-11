/** Pure helpers of the plan screens: option labels, map links, vote counts, the leader of a kind, the nudge. */
import type { PlanOption, PlanView } from '../api/plans-api';
// One check of map links on both sides: the server refuses what this would not send.
import { mapsSearchUrl } from '../../../server/src/plans/map-link';
import { nameKey } from '../../../server/src/plans/member-names';
import type { Locale, Translate } from '../i18n/i18n';
import { formatLeft, formatVnDateTime } from './vn-time';

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

const answered = (person: PlanView['participants'][number]): boolean => person.optionIds.length > 0 || person.rsvp === 'no';

/** The expected people (the creator's name list) nobody of the plan matches by name: they have not even opened the link. */
export function membersNotJoined(plan: PlanView): string[] {
  const joined = new Set(plan.participants.map((person) => nameKey(person.displayName)));
  return plan.memberNames.filter((name) => !joined.has(nameKey(name)));
}

/** The expected people who have not answered yet: not joined, or joined and not voted. In the order of the list. */
export function pendingMembers(plan: PlanView): string[] {
  const done = new Set(plan.participants.filter(answered).map((person) => nameKey(person.displayName)));
  return plan.memberNames.filter((name) => !done.has(nameKey(name)));
}

/**
 * How many people the plan expects: with a name list, everyone on the list plus everyone who joined (counted once by
 * name); else the group size the creator gave.
 */
export function expectedTotal(plan: PlanView): number | null {
  if (plan.memberNames.length === 0) return plan.groupSize;
  return new Set([...plan.memberNames, ...plan.participants.map((person) => person.displayName)].map(nameKey)).size;
}

/**
 * The nudge line: how many voted, or who (and how many) of the expected group have not yet. With a name list the
 * names are given; with only a group size, just the count.
 */
export type NudgeLine = { kind: 'voted'; n: number } | { kind: 'left'; k: number; names: string[] } | { kind: 'all' };

export function nudgeLine(plan: PlanView): NudgeLine {
  const voted = voterCount(plan);
  if (plan.memberNames.length > 0) {
    const names = pendingMembers(plan);
    return names.length > 0 ? { kind: 'left', k: names.length, names } : { kind: 'all' };
  }
  if (plan.groupSize === null) return { kind: 'voted', n: voted };
  const left = plan.groupSize - voted;
  return left > 0 ? { kind: 'left', k: left, names: [] } : { kind: 'all' };
}

/**
 * The text copied by "Chép lời nhắc", built from the plan as it is now: how many have voted or are still missing,
 * how long is left, and what leads (a tie names nobody). It is built on click, so a changed vote or the clock moves it.
 */
export function reminderText(plan: PlanView, link: string, now: Date, t: Translate, locale: Locale): string {
  const line = nudgeLine(plan);
  const left = formatLeft(new Date(plan.voteDeadline), now, t) ?? formatVnDateTime(plan.voteDeadline, locale);
  const picks = (['time', 'place'] as const)
    .map((kind) => {
      const options = optionsOf(plan, kind);
      const { leaderId } = kindLeader(options);
      const leader = options.find((option) => option.id === leaderId);
      return leader ? optionText(leader, locale) : null;
    })
    .filter((pick): pick is string => pick !== null);
  const lead = picks.length > 0 ? t('nudge.lead', { pick: picks.join(' · ') }) : '';
  const common = { title: plan.title, left, lead, link };
  if (line.kind === 'left') return t(line.names.length > 0 ? 'nudge.text.names' : 'nudge.text.left', { ...common, k: line.k, names: line.names.join(', ') });
  if (line.kind === 'voted') return t('nudge.text.voted', { ...common, n: line.n });
  return t('nudge.text.all', common);
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
