/**
 * The pure rules of the "who sits where" scene on a locked plan: who falls in which group, what each person who
 * stands outside says, where the tables, seats and standing spots are. No three.js here, so the plan ticket, the
 * story image and the tests can use it without the 3D chunk.
 */
import type { Activity, Participant, PlanOption, PlanView } from '../../api/plans-api';
import type { Locale, Translate } from '../../i18n/i18n';
import { lockedOptions, optionText } from '../plan-format';
import { formatVnDateTime, vnInputs } from '../vn-time';

/** Sit = voted the locked time and place; the rest stand outside for the reason of their group. */
export const SCENE_GROUPS = ['sit', 'time', 'place', 'both', 'none', 'no'] as const;
export type SceneGroup = (typeof SCENE_GROUPS)[number];

/** The beer-hall scene fits these activities; the others keep the plain ticket. */
const SCENE_ACTIVITIES: ReadonlySet<Activity> = new Set<Activity>(['dinner', 'lunch', 'party', 'birthday', 'team_building']);

export function hasScene(plan: PlanView): boolean {
  return (plan.status === 'locked' || plan.status === 'done') && SCENE_ACTIVITIES.has(plan.activity);
}

export interface Classified {
  group: SceneGroup;
  /** What the person picked instead on the axis that does not match (their first vote of that kind), if any. */
  time: PlanOption | null;
  place: PlanOption | null;
}

/**
 * The group of one participant. "No" always stands outside; nobody who picked nothing sits; a plan with only one
 * kind of option is judged on that kind; voting several options of a kind counts when one of them is the locked one.
 */
export function classify(person: Participant, plan: PlanView): Classified {
  if (person.rsvp === 'no') return { group: 'no', time: null, place: null };
  if (person.optionIds.length === 0) return { group: 'none', time: null, place: null };
  const { time: lockedTime, place: lockedPlace } = lockedOptions(plan);
  const voted = (kind: PlanOption['kind']): PlanOption[] => plan.options.filter((option) => option.kind === kind && person.optionIds.includes(option.id));
  const votedTime = voted('time');
  const votedPlace = voted('place');
  const timeOk = lockedTime === null || votedTime.some((option) => option.id === lockedTime.id);
  const placeOk = lockedPlace === null || votedPlace.some((option) => option.id === lockedPlace.id);
  const group: SceneGroup = timeOk && placeOk ? 'sit' : placeOk ? 'time' : timeOk ? 'place' : 'both';
  return { group, time: votedTime[0] ?? null, place: votedPlace[0] ?? null };
}

const SAY_PART_MAX = 22;
const SAY_BOTH_PLACE_MAX = 12;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "08/11 15:00": a time short enough to sit next to a place in one bubble. */
function compactTime(option: PlanOption): string {
  if (!option.startsAt) return clip(option.label, SAY_BOTH_PLACE_MAX);
  const { date, time } = vnInputs(new Date(option.startsAt));
  const [, month = '', day = ''] = date.split('-');
  return `${day}/${month} ${time}`;
}

/** The short line in the speech bubble of someone standing outside; null for a person who sits. */
export function sceneSay(classified: Classified, t: Translate, locale: Locale): string | null {
  const { group, time, place } = classified;
  if (group === 'sit') return null;
  if (group === 'none') return t('scene.say.none');
  if (group === 'no') return t('scene.say.no');
  if (group === 'time') return time ? t('scene.say.pick', { pick: clip(time.startsAt ? formatVnDateTime(time.startsAt, locale) : optionText(time, locale), SAY_PART_MAX) }) : t('scene.say.noTime');
  if (group === 'place') return place ? t('scene.say.pick', { pick: clip(optionText(place, locale), SAY_PART_MAX) }) : t('scene.say.noPlace');
  const parts = [time ? compactTime(time) : null, place ? clip(optionText(place, locale), SAY_BOTH_PLACE_MAX) : null].filter((part): part is string => part !== null);
  return t('scene.say.pick', { pick: parts.join(' · ') });
}

export interface SceneEntry {
  id: string;
  name: string;
  group: SceneGroup;
  say: string | null;
}

/** Everyone on the plan, the creator first (they take the first seat), each with a group and a bubble line. */
export function buildRoster(plan: PlanView, t: Translate, locale: Locale): SceneEntry[] {
  const ordered = [...plan.participants.filter((person) => person.isCreator), ...plan.participants.filter((person) => !person.isCreator)];
  return ordered.map((person) => {
    const classified = classify(person, plan);
    return { id: person.id, name: person.displayName, group: classified.group, say: sceneSay(classified, t, locale) };
  });
}

export function groupCounts(roster: SceneEntry[]): Array<{ group: SceneGroup; count: number }> {
  return SCENE_GROUPS.map((group) => ({ group, count: roster.filter((entry) => entry.group === group).length })).filter((row) => row.count > 0);
}

/* ---------- where things stand ---------- */

export const SEATS_PER_TABLE = 6;
export const MAX_TABLES = 8;
export const MAX_SITTERS = SEATS_PER_TABLE * MAX_TABLES;

export interface TableSpot {
  x: number;
  z: number;
}

export interface SeatSpot {
  x: number;
  z: number;
  table: number;
  /** On the far side of the table: faces the camera. */
  back: boolean;
  /** The x of the aisle beside this seat's table end, where a person walks in from the street. */
  aisleX: number;
}

export interface TableLayout {
  tables: TableSpot[];
  /** Back-side seats first (their faces show), then the near side. */
  seats: SeatSpot[];
}

const SIDE_OFFSET = 0.66;
const SEAT_STEPS = [-0.45, 0, 0.45] as const;
const AISLE = 1.35;

/** Tables grow with the people who sit: at least two, six seats each, one row up to two tables, then two rows. */
export function tableCount(sitting: number): number {
  return Math.max(2, Math.min(MAX_TABLES, Math.ceil(sitting / SEATS_PER_TABLE)));
}

export function layoutTables(sitting: number): TableLayout {
  const count = tableCount(sitting);
  const rows = count <= 2 ? 1 : 2;
  const perRow = Math.ceil(count / rows);
  const rowZ = rows === 1 ? [-3.5] : [-4.7, -2.4];
  const spacing = rows === 1 ? 3.2 : 2.7;
  const tables: TableSpot[] = [];
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    // Both rows sit on the same columns, so the aisle beside a table is clear down the whole depth of the room.
    const column = Math.floor((perRow - inRow) / 2) + (index % perRow);
    tables.push({ x: (column - (perRow - 1) / 2) * spacing, z: rowZ[row] ?? -3.5 });
  }
  const seats: SeatSpot[] = [];
  tables.forEach((table, index) => {
    for (const side of [-1, 1]) {
      for (const step of SEAT_STEPS) {
        seats.push({ x: table.x + step, z: table.z + side * SIDE_OFFSET, table: index, back: side < 0, aisleX: table.x + (step >= 0 ? AISLE : -AISLE) });
      }
    }
  });
  return { tables, seats: [...seats.filter((seat) => seat.back), ...seats.filter((seat) => !seat.back)] };
}

export interface Placement {
  seated: number;
  /** People beyond the seats of the largest layout: shown as "+N". */
  overflow: number;
}

export function placeSitters(sitting: number): Placement {
  return { seated: Math.min(sitting, MAX_SITTERS), overflow: Math.max(0, sitting - MAX_SITTERS) };
}

export type OutsideGroup = Exclude<SceneGroup, 'sit'>;

const OUTSIDE: Record<OutsideGroup, ReadonlyArray<readonly [number, number]>> = {
  time: [[-4.6, 1.0], [-3.6, 1.35], [-5.2, 1.6], [-4.0, 2.0]],
  place: [[4.3, 1.1], [5.1, 1.5], [3.6, 1.6], [4.8, 2.1]],
  both: [[1.2, 1.9], [2.2, 2.3], [0.2, 2.4], [2.6, 3.0]],
  none: [[-2.0, 2.7], [-1.0, 3.2], [-3.0, 3.2], [0, 2.6]],
  no: [[5.9, 2.9], [5.5, 3.6]],
};

export interface Spot {
  x: number;
  z: number;
  /** The point the person looks at. */
  lookX: number;
  lookZ: number;
}

/** The standing spot of the `index`-th person of an outside group; past the last slot they line up behind it. */
export function outsideSpot(group: OutsideGroup, index: number): Spot {
  const slots = OUTSIDE[group];
  const slot = slots[index % slots.length] ?? [0, 3];
  const spill = Math.floor(index / slots.length) * 0.45;
  const x = slot[0] + spill;
  const z = slot[1] + spill * 0.6;
  if (group === 'no') return { x, z, lookX: x + 5, lookZ: z + 0.2 };
  if (group === 'both') return { x, z, lookX: 0.8, lookZ: -3.3 };
  if (group === 'none') return { x, z, lookX: -0.6, lookZ: -3.3 };
  return { x, z, lookX: -0.4, lookZ: -3.5 };
}

/* ---------- camera ---------- */

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1.45;

/** How far the camera stands for a canvas of this shape (narrow canvases step back to keep both edges in view). */
export function cameraRadius(aspect: number): number {
  if (aspect < 0.9) return 18;
  if (aspect < 1.3) return 15;
  return 12.6;
}

export const clampZoom = (zoom: number): number => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
