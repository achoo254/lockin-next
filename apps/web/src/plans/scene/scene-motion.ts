/** How people move: the walk-in to the chair (once, when a plan has just been locked), and the idle life afterwards. */
import { type Person, setSeated } from './scene-people';
import type { SeatSpot } from './scene-model';

const WALK_SPEED = 1.8;
const TURN_TIME = 0.25;
const STEP_PERIOD = 8;
/** The street edge where people come in from. */
const STREET_Z = 1.2;

export interface Entrance {
  person: Person;
  /** Seconds after the scene starts before this person appears. */
  delay: number;
  path: Array<[number, number]>;
  length: number;
  yaw: number;
}

/** The gap between two people walking in: ~0.35 s, squeezed so a crowd of 48 still sits within five seconds. */
export function entranceDelay(index: number, count: number): number {
  return index * Math.min(0.35, 5 / Math.max(1, count));
}

export function makeEntrance(person: Person, seat: SeatSpot, index: number, count: number): Entrance {
  // In from the street, along the aisle at the end of the table, then across to the chair.
  const path: Array<[number, number]> = [[seat.aisleX, STREET_Z], [seat.aisleX, seat.z], [seat.x, seat.z]];
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot((path[i]?.[0] ?? 0) - (path[i - 1]?.[0] ?? 0), (path[i]?.[1] ?? 0) - (path[i - 1]?.[1] ?? 0));
  return { person, delay: entranceDelay(index, count), path, length, yaw: seat.back ? 0 : Math.PI };
}

/** Puts the person at the start of the walk, standing and out of sight until their turn. */
export function beginEntrance(entrance: Entrance): void {
  const { person, path } = entrance;
  setSeated(person, false);
  person.root.visible = false;
  person.root.position.set(path[0]?.[0] ?? 0, 0, path[0]?.[1] ?? 0);
}

function pointAt(path: Array<[number, number]>, distance: number): { x: number; z: number; yaw: number } {
  let left = distance;
  for (let i = 1; i < path.length; i++) {
    const [x0 = 0, z0 = 0] = path[i - 1] ?? [];
    const [x1 = 0, z1 = 0] = path[i] ?? [];
    const segment = Math.hypot(x1 - x0, z1 - z0);
    if (left <= segment || i === path.length - 1) {
      const k = segment === 0 ? 1 : Math.min(1, left / segment);
      return { x: x0 + (x1 - x0) * k, z: z0 + (z1 - z0) * k, yaw: Math.atan2(x1 - x0, z1 - z0) };
    }
    left -= segment;
  }
  return { x: 0, z: 0, yaw: 0 };
}

const lerpAngle = (from: number, to: number, k: number): number => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;

/** Moves one person for scene time `t`; true once they have sat down. */
export function stepEntrance(entrance: Entrance, t: number): boolean {
  const { person } = entrance;
  const elapsed = t - entrance.delay;
  if (elapsed < 0) return false;
  person.root.visible = true;
  const walked = elapsed * WALK_SPEED;
  if (walked < entrance.length) {
    const at = pointAt(entrance.path, walked);
    person.root.position.set(at.x, Math.abs(Math.sin(elapsed * STEP_PERIOD)) * 0.03, at.z);
    person.root.rotation.y = at.yaw;
    const swing = Math.sin(elapsed * STEP_PERIOD) * 0.5;
    person.arms[0].rotation.x = swing;
    person.arms[1].rotation.x = -swing;
    return false;
  }
  const last = entrance.path[entrance.path.length - 1] ?? [0, 0];
  person.root.position.set(last[0], 0, last[1]);
  const turned = Math.min(1, (walked - entrance.length) / (WALK_SPEED * TURN_TIME));
  const from = pointAt(entrance.path, entrance.length).yaw;
  person.root.rotation.y = lerpAngle(from, entrance.yaw, turned);
  if (turned < 1) return false;
  person.root.rotation.y = entrance.yaw;
  setSeated(person, true);
  return true;
}

/** The small life of a person who is in place: sipping, looking about, a slight bob, a bowed head. */
export function idle(person: Person, t: number, scale: number): void {
  const { head, arms } = person;
  if (person.seated) {
    const sip = Math.max(0, Math.sin(t * 0.7 + person.phase)) ** 6 * 0.75 * scale;
    arms[1].rotation.x = -1.05 - sip * 0.9;
    head.rotation.x = -sip * 0.12;
    head.rotation.y = Math.sin(t * 0.5 + person.phase) * 0.18 * scale;
  } else if (person.entry.group === 'no') {
    head.rotation.x = 0.35 + Math.sin(t * 0.9 + person.phase) * 0.03 * scale;
  } else {
    person.root.position.y = Math.abs(Math.sin(t * 1.4 + person.phase)) * 0.012 * scale;
    head.rotation.y = Math.sin(t * 0.6 + person.phase) * 0.35 * scale;
  }
}
