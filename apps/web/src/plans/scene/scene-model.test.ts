import { describe, expect, it } from 'vitest';
import type { PlanView } from '../../api/plans-api';
import { translator } from '../../i18n/i18n';
import { P1, P2, T1, T2, makePlan, person } from '../../test/plan-fixture';
import { sceneTranslate } from './scene-config';
import { MAX_SITTERS, MAX_SPECTATORS, buildRoster, classify, cameraRadius, clampZoom, duelSpot, groupCounts, hasScene, layoutStands, layoutTables, outsideSpot, placeSitters, sceneSay, sceneTheme, tableCount, ZOOM_MAX, ZOOM_MIN } from './scene-model';

const t = translator('vi');
const locked = (overrides: Partial<PlanView> = {}): PlanView => makePlan({ activity: 'dinner', status: 'locked', lockedOptionIds: [T1, P1], ...overrides });

describe('which plans get the scene', () => {
  it('shows it for a locked or done plan of a meal, party or birthday kind, and nothing else', () => {
    expect(hasScene(locked())).toBe(true);
    expect(hasScene(locked({ status: 'done', activity: 'lunch' }))).toBe(true);
    for (const activity of ['party', 'birthday', 'team_building'] as const) expect(hasScene(locked({ activity }))).toBe(true);
    expect(hasScene(locked({ status: 'open' }))).toBe(false);
    expect(hasScene(locked({ status: 'cancelled' }))).toBe(false);
    for (const activity of ['coffee', 'movie', 'karaoke', 'day_trip', 'meeting', 'other'] as const) expect(hasScene(locked({ activity }))).toBe(false);
  });
});

describe('the group of a participant', () => {
  const plan = locked();
  const group = (optionIds: string[], rsvp: 'going' | 'maybe' | 'no' | null = null): string => classify(person('x', 'Linh', optionIds, rsvp), plan).group;

  it('sits who voted the locked time and the locked place', () => {
    expect(group([T1, P1])).toBe('sit');
    expect(group([T1, P1], 'going')).toBe('sit');
    expect(group([T1, P1], 'maybe')).toBe('sit');
  });

  it('stands outside for the axis that differs', () => {
    expect(group([T2, P1])).toBe('time');
    expect(group([T1, P2])).toBe('place');
    expect(group([T2, P2])).toBe('both');
    expect(group([P1])).toBe('time');
    expect(group([T1])).toBe('place');
  });

  it('counts an axis as matching when one of several votes of that kind is the locked one', () => {
    expect(group([T1, T2, P1, P2])).toBe('sit');
    expect(group([T2, P1, P2])).toBe('time');
  });

  it('puts who picked nothing in "none" and who said no always in "no"', () => {
    expect(group([])).toBe('none');
    expect(group([], 'going')).toBe('none');
    expect(group([T1, P1], 'no')).toBe('no');
    expect(group([], 'no')).toBe('no');
  });

  it('judges a plan with only one kind of option on that kind', () => {
    const placesOnly = locked({ options: makePlan().options.filter((option) => option.kind === 'place'), lockedOptionIds: [P1] });
    expect(classify(person('x', 'Linh', [P1]), placesOnly).group).toBe('sit');
    expect(classify(person('x', 'Linh', [P2]), placesOnly).group).toBe('place');
  });

  it('classifies the creator like everyone else', () => {
    expect(classify(person('c', 'Minh', [T2, P1], null, true), plan).group).toBe('time');
  });

  it('remembers what the person picked instead', () => {
    const result = classify(person('x', 'Linh', [T2, P2]), plan);
    expect([result.time?.id, result.place?.id]).toEqual([T2, P2]);
  });
});

describe('what a person standing outside says', () => {
  const plan = locked();
  const say = (optionIds: string[], rsvp: 'going' | 'no' | null = null): string | null => sceneSay(classify(person('x', 'Linh', optionIds, rsvp), plan), t, 'vi');

  it('names the other time, the other place, or both, in a short line', () => {
    expect(say([T2, P1])).toBe('Mình chọn Chủ Nhật 08/11, 15:00');
    expect(say([T1, P2])).toBe('Mình chọn Quán cà phê B');
    expect(say([T2, P2])).toBe('Mình chọn 08/11 15:00 · Quán cà phê…');
  });

  it('says it has not voted, or cannot go, and says nothing for who sits', () => {
    expect(say([])).toBe('Mình chưa vote');
    expect(say([T1, P1], 'no')).toBe('Mình không đi được');
    expect(say([T1, P1])).toBeNull();
  });

  it('says what is missing when the person voted only the locked option of the other axis', () => {
    expect(say([P1])).toBe('Mình chưa chọn giờ');
    expect(say([T1])).toBe('Mình chưa chọn quán');
  });

  it('speaks English with the English dictionary', () => {
    expect(sceneSay(classify(person('x', 'Linh', []), plan), translator('en'), 'en')).toBe('I have not voted');
    expect(sceneSay(classify(person('x', 'Linh', [T1, P2]), plan), translator('en'), 'en')).toBe('I picked Quán cà phê B');
  });

  it('keeps a long place name short', () => {
    const long = locked({ options: makePlan().options.map((option) => (option.id === P2 ? { ...option, label: 'Nhà hàng bia hơi có cái tên rất dài' } : option)) });
    const line = sceneSay(classify(person('x', 'Linh', [T1, P2]), long), t, 'vi') ?? '';
    expect(line.length).toBeLessThanOrEqual('Mình chọn '.length + 22);
    expect(line.endsWith('…')).toBe(true);
  });
});

describe('the roster', () => {
  it('lists the creator first, then the others in order, each with a group', () => {
    const plan = locked({ participants: [person('a', 'An', [T1, P1]), person('m', 'Minh', [T2, P1], null, true), person('b', 'Bình', [], 'no')] });
    const roster = buildRoster(plan, t, 'vi');
    expect(roster.map((entry) => [entry.name, entry.group])).toEqual([['Minh', 'time'], ['An', 'sit'], ['Bình', 'no']]);
    expect(groupCounts(roster)).toEqual([{ group: 'sit', count: 1 }, { group: 'time', count: 1 }, { group: 'no', count: 1 }]);
  });
});

describe('tables and seats', () => {
  it('has at least two tables and one more for every six people, up to eight', () => {
    expect([0, 1, 12, 13, 18, 19, 48, 100].map(tableCount)).toEqual([2, 2, 2, 3, 3, 4, 8, 8]);
  });

  it('puts up to two tables in one row and more in two rows', () => {
    expect(new Set(layoutTables(12).tables.map((table) => table.z)).size).toBe(1);
    expect(new Set(layoutTables(13).tables.map((table) => table.z)).size).toBe(2);
    expect(layoutTables(48).tables).toHaveLength(8);
  });

  it('seats six at each table, the far side first so faces show', () => {
    const { seats, tables } = layoutTables(12);
    expect(seats).toHaveLength(tables.length * 6);
    const firstNear = seats.findIndex((seat) => !seat.back);
    expect(seats.slice(0, firstNear).every((seat) => seat.back)).toBe(true);
    expect(seats.slice(firstNear).every((seat) => !seat.back)).toBe(true);
    expect(firstNear).toBe(6);
  });

  it('never puts two seats on the same spot, and keeps every aisle clear of every table', () => {
    for (const count of [1, 12, 13, 19, 30, 48]) {
      const { seats, tables } = layoutTables(count);
      expect(new Set(seats.map((seat) => `${seat.x.toFixed(2)},${seat.z.toFixed(2)}`)).size).toBe(seats.length);
      for (const seat of seats) for (const table of tables) expect(Math.abs(seat.aisleX - table.x)).toBeGreaterThan(0.75);
    }
  });

  it('keeps both rows on the same columns', () => {
    for (const count of [13, 19, 30, 40]) {
      const { tables } = layoutTables(count);
      const rows = [...new Set(tables.map((table) => table.z))].sort((a, b) => a - b);
      expect(rows).toHaveLength(2);
      const xs = (z: number): Set<string> => new Set(tables.filter((table) => table.z === z).map((table) => table.x.toFixed(3)));
      const [far, near] = rows.map((z) => xs(z));
      for (const x of near ?? []) expect(far?.has(x)).toBe(true);
    }
  });

  it('seats everyone up to the capacity and counts the rest as "+N"', () => {
    expect(placeSitters(20)).toEqual({ seated: 20, overflow: 0 });
    expect(placeSitters(MAX_SITTERS + 5)).toEqual({ seated: MAX_SITTERS, overflow: 5 });
  });
});

describe('where the others stand', () => {
  it('has a spot per person and lines the extra ones up behind the last slot', () => {
    const first = outsideSpot('time', 0);
    const wrapped = outsideSpot('time', 4);
    expect(wrapped.x).toBeGreaterThan(first.x);
    expect(new Set(Array.from({ length: 12 }, (_, i) => `${outsideSpot('none', i).x},${outsideSpot('none', i).z}`)).size).toBe(12);
  });

  it('turns the people who said no away, and the rest toward the tables', () => {
    const away = outsideSpot('no', 0);
    expect(away.lookX).toBeGreaterThan(away.x);
    const waiting = outsideSpot('none', 0);
    expect(waiting.lookZ).toBeLessThan(waiting.z);
  });
});

describe('camera', () => {
  it('stands further back for a narrow canvas and keeps the zoom in range', () => {
    expect(cameraRadius(0.7)).toBeGreaterThan(cameraRadius(1.1));
    expect(cameraRadius(1.1)).toBeGreaterThan(cameraRadius(1.6));
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(1)).toBe(1);
  });
});

describe('names on the creator’s list in the scene', () => {
  it('stands the ones who never joined outside as "not voted", and counts the joined only once', () => {
    const plan = locked({ memberNames: ['Linh', 'Vy', 'Tú'], participants: [person('a', 'linh', [T1, P1], 'going', true)] });
    const roster = buildRoster(plan, t, 'vi');
    expect(roster.map((entry) => [entry.name, entry.group])).toEqual([
      ['linh', 'sit'],
      ['Vy', 'none'],
      ['Tú', 'none'],
    ]);
    expect(roster[1]?.say).toBe('Mình chưa vote');
  });
});

describe('the arena of a solo game plan', () => {
  const duel: NonNullable<PlanView['duel']> = { game: 'lmht', bestOf: 3, winCondition: 'first_blood', rules: [], customRules: [], stake: null };
  const solo = (participants: PlanView['participants']): PlanView => locked({ activity: 'solo_game', duel, participants });
  const going = (id: string, name: string, options: string[] = [T1, P1], creator = false): PlanView['participants'][number] => person(id, name, options, 'going', creator);

  it('gets the scene when locked, as the arena theme', () => {
    expect(hasScene(solo([]))).toBe(true);
    expect(hasScene({ ...solo([]), status: 'open' })).toBe(false);
    expect(sceneTheme(solo([]))).toBe('arena');
    expect(sceneTheme(locked())).toBe('hall');
  });

  it('makes the creator blue and the next one red: two people are one against one', () => {
    const roster = buildRoster(solo([going('b', 'Bình'), going('m', 'Minh', [], true), going('c', 'Chi')]), t, 'vi');
    expect(roster.map((entry) => [entry.name, entry.group, entry.team])).toEqual([
      ['Minh', 'duel', 'blue'],
      ['Bình', 'duel', 'red'],
      ['Chi', 'duel', 'blue'],
    ]);
    expect(roster.every((entry) => entry.say === null)).toBe(true);
  });

  it('takes the first ten who are going as five against five, and everyone else watches whatever they voted or said', () => {
    const people = Array.from({ length: 10 }, (_, i) => going(`p${i}`, `Người ${i}`, [T1, P1], i === 0));
    const extra = [
      going('s1', 'Khán 1'),
      person('s2', 'Khán 2', [T2, P1], 'going'),
      person('s3', 'Khán 3', [], 'maybe'),
      person('s4', 'Khán 4', [T1, P1], 'maybe'),
      person('s5', 'Khán 5', [], 'no'),
      person('s6', 'Khán 6', [T1, P1]),
      person('s7', 'Khán 7', []),
    ];
    const roster = buildRoster(solo([...people, ...extra]), t, 'vi');
    const players = roster.filter((entry) => entry.group === 'duel');
    expect(players).toHaveLength(10);
    expect(players.filter((entry) => entry.team === 'blue')).toHaveLength(5);
    expect(players.filter((entry) => entry.team === 'red')).toHaveLength(5);
    const rest = roster.filter((entry) => entry.group !== 'duel');
    expect(rest.map((entry) => entry.name)).toEqual(['Khán 1', 'Khán 2', 'Khán 3', 'Khán 4', 'Khán 5', 'Khán 6', 'Khán 7']);
    expect(rest.every((entry) => entry.group === 'sit' && entry.say === null)).toBe(true);
  });

  it('puts the names on the creator’s list who have not joined yet in the stands too', () => {
    const plan = { ...solo([going('m', 'Minh', [], true)]), memberNames: ['Minh', 'Khánh', 'Trung'] };
    expect(buildRoster(plan, t, 'vi').map((entry) => [entry.name, entry.group])).toEqual([['Minh', 'duel'], ['Khánh', 'sit'], ['Trung', 'sit']]);
  });

  it('does not make a player of someone who is not going, and does not mark players of a plan without rules', () => {
    const maybe = solo([person('m', 'Minh', [T1, P1], 'maybe', true), going('b', 'Bình')]);
    expect(buildRoster(maybe, t, 'vi').map((entry) => [entry.name, entry.group])).toEqual([['Minh', 'sit'], ['Bình', 'duel']]);
    expect(buildRoster(locked({ participants: [going('m', 'Minh', [T1, P1], true)] }), t, 'vi')[0]?.group).toBe('sit');
  });

  it('draws the arena in its own words', () => {
    const say = sceneTranslate(t, 'arena');
    expect(say('scene.group.sit')).toBe('Khán giả');
    expect(say('scene.say.noPlace')).toBe('Mình chưa chọn chỗ');
    expect(say('scene.group.none')).toBe(t('scene.group.none'));
    expect(sceneTranslate(t, 'hall')('scene.group.sit')).toBe('Ngồi bàn');
  });

  it('forms each side in a line from the middle towards its tower, facing the other side', () => {
    const blue = [0, 1, 2, 3, 4].map((i) => duelSpot('blue', i));
    const red = [0, 1, 2, 3, 4].map((i) => duelSpot('red', i));
    expect(blue.every((spot) => spot.x < 0) && red.every((spot) => spot.x > 0)).toBe(true);
    expect(blue.map((spot) => Math.abs(spot.x))).toEqual(red.map((spot) => Math.abs(spot.x)));
    expect([...blue, ...red].every((spot) => Math.abs(spot.x) < 4.5 && spot.lookX === 0)).toBe(true);
    expect(new Set(blue.map((spot) => spot.x)).size).toBe(5);
  });

  it('seats spectators in rows of twelve from the middle out, front row first, up to three rows', () => {
    expect(layoutStands(1).rows).toBe(1);
    expect(layoutStands(13).rows).toBe(2);
    expect(layoutStands(100).rows).toBe(3);
    const { seats } = layoutStands(36);
    expect(seats).toHaveLength(MAX_SPECTATORS);
    expect(seats.slice(0, 12).map((seat) => Math.abs(seat.x))).toEqual([0.45, 0.45, 1.35, 1.35, 2.25, 2.25, 3.15, 3.15, 4.05, 4.05, 4.95, 4.95]);
    expect(seats.map((seat) => seat.table)).toEqual([...Array(12).fill(0), ...Array(12).fill(1), ...Array(12).fill(2)]);
    expect(seats[12]?.y).toBeGreaterThan(seats[0]?.y ?? 0);
    expect(placeSitters(40, MAX_SPECTATORS)).toEqual({ seated: 36, overflow: 4 });
  });
});
