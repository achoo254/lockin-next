/**
 * The funnel in numbers, read from plans, votes and plan_events: plans made, opens → joins → votes, plans locked
 * and done, creators coming back, guests who became creators, plans made signed in or signed out and saved to an
 * account later. Plans past retention are gone, so the numbers cover the last DELETE_AFTER_DAYS days of deadlines at
 * most. `excludeSubs` drops those creators' plans (the owner's own); plans not saved to an account always count.
 */
import { and, count, countDistinct, eq, gte, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { PLAN_STATUSES, type PlanStatus, planEvents, plans, votes } from '../db/schema';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A creator "comes back" when they make another plan within this many days of their first. */
export const RETURN_WINDOW_DAYS = 30;

export interface PlanStats {
  plans: number;
  byStatus: Record<PlanStatus, number>;
  /** Plans with at least two people who voted (current votes). */
  plansWithTwoVoters: number;
  /** First opens of a link per browser (the creator's own opens are not counted). */
  opens: number;
  /** Guests who joined (the creator joining their own plan is not counted). */
  joins: number;
  /** Guests who voted at least once. */
  voters: number;
  /** Plans that were ever locked in, marked done, cancelled. */
  locked: number;
  done: number;
  cancelled: number;
  /** Accounts that own a plan (plans made signed out count once they are saved to an account). */
  creators: number;
  returningCreators: number;
  /**
   * Creators who made a plan in a browser that had joined another plan as a guest: accounts, plus each plan made
   * signed out and not saved (such a creator has no identity across plans).
   */
  guestsTurnedCreators: number;
  /** Plans made signed in, and signed out (`plan_created` creatorKind; older plans were all made signed in). */
  madeSignedIn: number;
  madeSignedOut: number;
  /** Plans made signed out and saved to an account later (`plan_claimed`). */
  claimed: number;
}

export async function computeStats(db: Db, options: { excludeSubs?: string[] } = {}): Promise<PlanStats> {
  const excluded = options.excludeSubs ?? [];
  // `not in` alone would drop the plans without an account too (null is never "not in" a list).
  const counted = excluded.length > 0 ? or(isNull(plans.creatorSub), notInArray(plans.creatorSub, excluded)) : undefined;

  const statusRows = await db.select({ status: plans.status, n: count() }).from(plans).where(counted).groupBy(plans.status);
  const byStatus: Record<PlanStatus, number> = { open: 0, locked: 0, done: 0, cancelled: 0, expired: 0 };
  for (const row of statusRows) byStatus[row.status] = Number(row.n);

  const eventRows = await db
    .select({
      type: planEvents.type,
      actor: planEvents.actor,
      n: count(),
      participants: countDistinct(planEvents.participantId),
      plans: countDistinct(planEvents.planId),
    })
    .from(planEvents)
    .innerJoin(plans, eq(plans.id, planEvents.planId))
    .where(and(counted, inArray(planEvents.type, ['link_opened', 'joined', 'voted', 'locked', 'done', 'cancelled', 'plan_claimed'])))
    .groupBy(planEvents.type, planEvents.actor);
  const event = (type: string, actor: string | null, field: 'n' | 'participants' | 'plans'): number =>
    eventRows.filter((row) => row.type === type && (actor === null || row.actor === actor)).reduce((sum, row) => sum + Number(row[field]), 0);

  const busyPlans = await db
    .select({ planId: votes.planId })
    .from(votes)
    .innerJoin(plans, eq(plans.id, votes.planId))
    .where(counted)
    .groupBy(votes.planId)
    .having(gte(countDistinct(votes.participantId), 2));

  const creations = await db.select({ sub: plans.creatorSub, at: plans.createdAt }).from(plans).where(counted).orderBy(plans.createdAt);
  const firstAndNext = new Map<string, Date[]>();
  for (const row of creations) if (row.sub !== null) firstAndNext.set(row.sub, [...(firstAndNext.get(row.sub) ?? []), row.at]);
  let returningCreators = 0;
  for (const times of firstAndNext.values()) {
    const [first, second] = times;
    if (first && second && second.getTime() - first.getTime() <= RETURN_WINDOW_DAYS * DAY_MS) returningCreators++;
  }

  const [converted] = await db
    .select({ n: sql<number>`count(distinct coalesce(${plans.creatorSub}, ${plans.id}::text))` })
    .from(planEvents)
    .innerJoin(plans, eq(plans.id, planEvents.planId))
    .where(and(counted, eq(planEvents.type, 'plan_created'), isNotNull(planEvents.sourcePlanId)));

  const creatorKind = sql<string | null>`${planEvents.payload}->>'creatorKind'`;
  const kindRows = await db
    .select({ kind: creatorKind, n: count() })
    .from(planEvents)
    .innerJoin(plans, eq(plans.id, planEvents.planId))
    .where(and(counted, eq(planEvents.type, 'plan_created')))
    .groupBy(creatorKind);
  const madeSignedOut = kindRows.filter((row) => row.kind === 'guest').reduce((sum, row) => sum + Number(row.n), 0);
  const madeSignedIn = kindRows.filter((row) => row.kind !== 'guest').reduce((sum, row) => sum + Number(row.n), 0);

  return {
    plans: creations.length,
    byStatus,
    plansWithTwoVoters: busyPlans.length,
    opens: event('link_opened', null, 'n'),
    joins: event('joined', 'participant', 'n'),
    voters: event('voted', 'participant', 'participants'),
    locked: event('locked', null, 'plans'),
    done: event('done', null, 'plans'),
    cancelled: event('cancelled', null, 'plans'),
    creators: firstAndNext.size,
    returningCreators,
    guestsTurnedCreators: Number(converted?.n ?? 0),
    madeSignedIn,
    madeSignedOut,
    claimed: event('plan_claimed', null, 'plans'),
  };
}

function rate(part: number, whole: number): string {
  return whole === 0 ? '-' : `${((part / whole) * 100).toFixed(1)}%`;
}

/** Plain-text report, one figure per line. */
export function formatStats(stats: PlanStats, label: string): string {
  const statuses = PLAN_STATUSES.map((status) => `${status} ${stats.byStatus[status]}`).join(', ');
  return [
    `Plans (${label})`,
    `  plans made:              ${stats.plans} (${statuses})`,
    `  plans with >= 2 voters:  ${stats.plansWithTwoVoters}`,
    `Funnel`,
    `  link opens:              ${stats.opens}`,
    `  guests joined:           ${stats.joins} (${rate(stats.joins, stats.opens)} of opens)`,
    `  guests voted:            ${stats.voters} (${rate(stats.voters, stats.joins)} of joins)`,
    `  plans locked in:         ${stats.locked} (${rate(stats.locked, stats.plans)} of plans)`,
    `  plans done:              ${stats.done} (${rate(stats.done, stats.locked)} of locked)`,
    `  plans cancelled:         ${stats.cancelled}`,
    `Creators`,
    `  creators:                ${stats.creators}`,
    `  back within ${RETURN_WINDOW_DAYS} days:     ${stats.returningCreators} (${rate(stats.returningCreators, stats.creators)})`,
    `  guests turned creators:  ${stats.guestsTurnedCreators}`,
    `Signed in or not`,
    `  made signed in:          ${stats.madeSignedIn}`,
    `  made signed out:         ${stats.madeSignedOut} (${rate(stats.madeSignedOut, stats.plans)} of plans)`,
    `  saved to an account:     ${stats.claimed} (${rate(stats.claimed, stats.madeSignedOut)} of made signed out)`,
  ].join('\n');
}

/** `STATS_EXCLUDE_SUBS`: comma- or space-separated account subs. */
export function parseSubs(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((sub) => sub.trim())
    .filter(Boolean);
}
