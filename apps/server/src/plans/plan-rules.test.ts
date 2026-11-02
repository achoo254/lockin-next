import { describe, expect, it } from 'vitest';
import type { PlanStatus } from '../db/schema';
import { HttpError } from '../http-error';
import { type PlanAction, assertCanDo, canDo, deleteAt, effectiveStatus, isPastDeletion, readOnlyAt } from './plan-rules';
import { DELETE_AFTER_DAYS, READ_ONLY_AFTER_DAYS } from './retention';

const DAY = 24 * 60 * 60 * 1000;
const deadline = new Date('2026-11-10T12:00:00Z');
const at = (offsetMs: number): Date => new Date(deadline.getTime() + offsetMs);
const plan = (status: PlanStatus): { status: PlanStatus; voteDeadline: Date } => ({ status, voteDeadline: deadline });

function codeOf(action: PlanAction, status: PlanStatus, now: Date): string | null {
  try {
    assertCanDo(action, plan(status), now);
    return null;
  } catch (error) {
    if (error instanceof HttpError) return `${error.status} ${error.code}`;
    throw error;
  }
}

describe('plan state machine', () => {
  it('keeps the retention numbers the privacy page prints', () => {
    expect([READ_ONLY_AFTER_DAYS, DELETE_AFTER_DAYS]).toEqual([30, 90]);
    expect(readOnlyAt(deadline).getTime() - deadline.getTime()).toBe(30 * DAY);
    expect(deleteAt(deadline).getTime() - deadline.getTime()).toBe(90 * DAY);
  });

  it('takes votes only while open and before the deadline', () => {
    expect(codeOf('vote', 'open', at(-1))).toBeNull();
    expect(codeOf('vote', 'open', at(0))).toBe('409 deadline-passed');
    for (const status of ['locked', 'done', 'cancelled'] as const) expect(codeOf('vote', status, at(-1))).toBe('409 plan-not-open');
  });

  it('lets the creator lock an open plan past its deadline, but not twice', () => {
    expect(codeOf('lock', 'open', at(DAY))).toBeNull();
    expect(codeOf('lock', 'locked', at(-1))).toBe('409 plan-not-open');
  });

  it('marks done only a locked plan and cancels only an open or locked one', () => {
    expect(codeOf('done', 'locked', at(DAY))).toBeNull();
    expect(codeOf('done', 'open', at(-1))).toBe('409 plan-not-locked');
    expect(codeOf('cancel', 'open', at(-1))).toBeNull();
    expect(codeOf('cancel', 'locked', at(-1))).toBeNull();
    expect(codeOf('cancel', 'done', at(-1))).toBe('409 plan-closed');
    expect(codeOf('cancel', 'cancelled', at(-1))).toBe('409 plan-closed');
  });

  it('still lets people join and say whether they go after the lock', () => {
    expect(canDo('join', plan('locked'), at(DAY))).toBe(true);
    expect(canDo('rsvp', plan('locked'), at(DAY))).toBe(true);
    expect(canDo('join', plan('cancelled'), at(-1))).toBe(false);
  });

  it('turns open and locked plans read-only 30 days after the deadline, and refuses every action then', () => {
    expect(effectiveStatus(plan('open'), at(30 * DAY - 1))).toBe('open');
    expect(effectiveStatus(plan('open'), at(30 * DAY))).toBe('expired');
    expect(effectiveStatus(plan('locked'), at(30 * DAY))).toBe('expired');
    expect(effectiveStatus(plan('done'), at(30 * DAY))).toBe('done');
    expect(effectiveStatus(plan('cancelled'), at(30 * DAY))).toBe('cancelled');
    for (const action of ['join', 'vote', 'rsvp', 'edit', 'lock', 'cancel', 'done', 'rotateLink'] as const) {
      expect(codeOf(action, 'open', at(30 * DAY))).toBe('409 plan-expired');
    }
    expect(isPastDeletion(plan('done'), at(90 * DAY - 1))).toBe(false);
    expect(isPastDeletion(plan('done'), at(90 * DAY))).toBe(true);
  });
});
