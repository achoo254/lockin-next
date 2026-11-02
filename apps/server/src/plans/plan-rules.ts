/**
 * The plan state machine. `open` → `locked` → `done`; `cancelled` ends an open or locked plan. A plan that is still
 * open or locked READ_ONLY_AFTER_DAYS after its vote deadline turns `expired` (read-only), and every plan is deleted
 * DELETE_AFTER_DAYS after its deadline. Votes are taken while the plan is open and before its deadline; past the
 * deadline the creator can still lock it in. Pure functions: callers pass the clock.
 */
import type { PlanStatus } from '../db/schema';
import { HttpError } from '../http-error';
import { DELETE_AFTER_DAYS, READ_ONLY_AFTER_DAYS } from './retention';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlanClock {
  status: PlanStatus;
  voteDeadline: Date;
}

export function readOnlyAt(voteDeadline: Date): Date {
  return new Date(voteDeadline.getTime() + READ_ONLY_AFTER_DAYS * DAY_MS);
}

export function deleteAt(voteDeadline: Date): Date {
  return new Date(voteDeadline.getTime() + DELETE_AFTER_DAYS * DAY_MS);
}

/** Plans whose vote deadline is at or before this are read-only at `now`. */
export function readOnlyCutoff(now: Date): Date {
  return new Date(now.getTime() - READ_ONLY_AFTER_DAYS * DAY_MS);
}

/** Plans whose vote deadline is at or before this are deleted at `now`. */
export function deleteCutoff(now: Date): Date {
  return new Date(now.getTime() - DELETE_AFTER_DAYS * DAY_MS);
}

/** The status the plan has at `now`: the stored one, or `expired` once an open or locked plan is past read-only. */
export function effectiveStatus(plan: PlanClock, now: Date): PlanStatus {
  const live = plan.status === 'open' || plan.status === 'locked';
  return live && now.getTime() >= readOnlyAt(plan.voteDeadline).getTime() ? 'expired' : plan.status;
}

export function isPastDeletion(plan: PlanClock, now: Date): boolean {
  return now.getTime() >= deleteAt(plan.voteDeadline).getTime();
}

export type PlanAction = 'join' | 'vote' | 'rsvp' | 'edit' | 'lock' | 'cancel' | 'done' | 'rotateLink';

/** The statuses each action is allowed in (an expired plan allows nothing). */
const ALLOWED: Record<PlanAction, readonly PlanStatus[]> = {
  // People can still join and say whether they go after the lock: the result card lists who is going.
  join: ['open', 'locked'],
  rsvp: ['open', 'locked'],
  vote: ['open'],
  edit: ['open'],
  lock: ['open'],
  cancel: ['open', 'locked'],
  done: ['locked'],
  rotateLink: ['open', 'locked', 'done', 'cancelled'],
};

/** The error code when the status does not allow the action. */
const WRONG_STATUS: Record<PlanAction, string> = {
  join: 'plan-closed',
  rsvp: 'plan-closed',
  vote: 'plan-not-open',
  edit: 'plan-not-open',
  lock: 'plan-not-open',
  cancel: 'plan-closed',
  done: 'plan-not-locked',
  rotateLink: 'plan-closed',
};

/** The stable error code for an action refused because of the plan's status (or deadline). */
function refusal(action: PlanAction, plan: PlanClock, now: Date): string | null {
  const status = effectiveStatus(plan, now);
  if (status === 'expired') return 'plan-expired';
  if (!ALLOWED[action].includes(status)) return WRONG_STATUS[action];
  if (action === 'vote' && now.getTime() >= plan.voteDeadline.getTime()) return 'deadline-passed';
  return null;
}

export function canDo(action: PlanAction, plan: PlanClock, now: Date): boolean {
  return refusal(action, plan, now) === null;
}

/** Throws a 409 with the reason when the plan's status or deadline does not allow the action. */
export function assertCanDo(action: PlanAction, plan: PlanClock, now: Date): void {
  const code = refusal(action, plan, now);
  if (code) throw new HttpError(409, code);
}
