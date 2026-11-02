/**
 * Plans, their options, participants and votes in the database. Every change that depends on the plan's status
 * runs in one transaction holding the plan row: creator actions take it FOR UPDATE, guest actions FOR SHARE, so a
 * vote never lands after a lock and two locks cannot both win. Every change is logged in plan_events with
 * participant ids only, never names.
 *
 * A plan's creator is its account (`creator_sub`) or whoever holds its creator token (the creator cookie, or the
 * private manage link that sets it): either one may run the creator actions.
 */
import { randomUUID } from 'node:crypto';
import { type SQL, and, asc, count, desc, eq, inArray, lte, notInArray, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import { type EventActor, type OptionKind, type PlanStatus, type Rsvp, participants, planEvents, planOptions, plans, votes } from '../db/schema';
import { HttpError } from '../http-error';
import { type CreatePlanInput, type OptionInput, type UpdatePlanInput, assertDeadline } from './plan-input';
import { type PlanAction, assertCanDo, deleteCutoff, effectiveStatus, isPastDeletion, readOnlyCutoff } from './plan-rules';
import { manageSealContext } from './share-link';
import type { ShareTokenBox } from './share-token-box';
import { hashToken, newToken } from './tokens';

export type PlanRow = typeof plans.$inferSelect;
export type ParticipantRow = typeof participants.$inferSelect;
export type OptionRow = typeof planOptions.$inferSelect;

/** Who may be the creator: the signed-in account (if any) and the creator token from this plan's cookie (if any). */
export interface CreatorKey {
  sub: string | null;
  creatorToken?: string | null;
}

/** Who is asking: a CreatorKey, and the guest token from this plan's guest cookie (if any). */
export interface Requester extends CreatorKey {
  guestToken: string | null;
}

/** Whether the key opens the creator's side of the plan: its owning account, or its creator token. */
export function isPlanCreator(plan: Pick<PlanRow, 'creatorSub' | 'creatorTokenHash'>, key: CreatorKey): boolean {
  if (key.sub !== null && key.sub === plan.creatorSub) return true;
  return typeof key.creatorToken === 'string' && plan.creatorTokenHash !== null && hashToken(key.creatorToken) === plan.creatorTokenHash;
}

/** Refusing someone who is not the creator: signed out, they may still sign in (401); signed in, it is not theirs (403). */
function notCreator(key: CreatorKey): HttpError {
  return key.sub === null ? new HttpError(401, 'sign-in-required') : new HttpError(403, 'not-creator');
}

/** How the creator made the plan, in `plan_created` (pnpm stats): signed in, or signed out. */
export type CreatorKind = 'account' | 'guest';

const LIVE_STATUSES: PlanStatus[] = ['open', 'locked'];
const notFound = (): HttpError => new HttpError(404, 'not-found');

interface EventInput {
  planId: string;
  actor: EventActor;
  type: string;
  participantId?: string | null;
  payload?: Record<string, string | number | boolean | string[]> | null;
  sourcePlanId?: string | null;
}

async function logEvents(db: Db, now: Date, events: EventInput[]): Promise<void> {
  if (events.length === 0) return;
  await db.insert(planEvents).values(events.map((event) => ({ ...event, createdAt: now })));
}

function optionRows(planId: string, options: OptionInput[]): Array<typeof planOptions.$inferInsert> {
  const order: Record<OptionKind, number> = { time: 0, place: 0 };
  return options.map((option) => ({
    planId,
    kind: option.kind,
    label: option.label,
    mapUrl: option.kind === 'place' ? option.mapUrl : null,
    startsAt: option.kind === 'time' ? option.startsAt : null,
    sortOrder: order[option.kind]++,
  }));
}

/**
 * Makes a plan and its options; the creator joins it at once when a name is given, as going (a plan they make is one
 * they go to; they can still change it). `creatorSub` null: made signed out, owned by the creator token alone.
 * Returns the share token and the creator token, each stored as its hash (lookups) and sealed with `box` (shown to
 * the creator again).
 */
export async function createPlan(
  db: Db,
  args: { creatorSub: string | null; input: CreatePlanInput; sourcePlanId: string | null; box: ShareTokenBox; now: Date },
): Promise<{ plan: PlanRow; shareToken: string; creatorToken: string }> {
  const { creatorSub, input, sourcePlanId, box, now } = args;
  assertDeadline(input.voteDeadline, now);
  const shareToken = newToken();
  const creatorToken = newToken();
  const creatorKind: CreatorKind = creatorSub === null ? 'guest' : 'account';
  // The id is made here: the sealed token is bound to it.
  const id = randomUUID();
  const plan = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(plans)
      .values({
        id,
        creatorSub,
        title: input.title,
        activity: input.activity,
        area: input.area,
        budgetPerPerson: input.budgetPerPerson,
        groupSize: input.groupSize,
        voteDeadline: input.voteDeadline,
        shareTokenHash: hashToken(shareToken),
        shareTokenEnc: box.seal(shareToken, id),
        creatorTokenHash: hashToken(creatorToken),
        manageTokenEnc: box.seal(creatorToken, manageSealContext(id)),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('plan insert returned no row');
    await tx.insert(planOptions).values(optionRows(row.id, input.options));
    const events: EventInput[] = [{ planId: row.id, actor: 'creator', type: 'plan_created', sourcePlanId, payload: { creatorKind } }];
    if (input.creatorDisplayName) {
      const [me] = await tx
        .insert(participants)
        .values({ planId: row.id, displayName: input.creatorDisplayName, isCreator: true, creatorSub, rsvp: 'going', joinedAt: now })
        .returning({ id: participants.id });
      events.push({ planId: row.id, actor: 'creator', type: 'joined', participantId: me?.id ?? null });
    }
    await logEvents(tx, now, events);
    return row;
  });
  return { plan, shareToken, creatorToken };
}

/**
 * The plan a browser joined as a guest before (its guest cookies), if any: recorded as the source of a new plan to
 * count guests who become creators. Only a cookie whose token belongs to a participant of that very plan counts.
 */
export async function findJoinedPlanId(db: Db, cookies: Array<{ planId: string; token: string }>): Promise<string | null> {
  if (cookies.length === 0) return null;
  const hashed = cookies.map((cookie) => ({ planId: cookie.planId, hash: hashToken(cookie.token) }));
  const rows = await db
    .select({ planId: participants.planId, hash: participants.guestTokenHash })
    .from(participants)
    .where(
      inArray(
        participants.guestTokenHash,
        hashed.map((c) => c.hash),
      ),
    )
    .orderBy(asc(participants.joinedAt));
  return rows.find((row) => hashed.some((c) => c.planId === row.planId && c.hash === row.hash))?.planId ?? null;
}

/**
 * Retention at read time, for a plan the hourly sweep has not reached yet: deleted (null) once past deletion,
 * stored as `expired` once past read-only.
 */
async function settle(db: Db, plan: PlanRow, now: Date): Promise<PlanRow | null> {
  if (isPastDeletion(plan, now)) {
    await db.delete(plans).where(eq(plans.id, plan.id));
    return null;
  }
  if (effectiveStatus(plan, now) !== 'expired' || plan.status === 'expired') return plan;
  const [expired] = await db
    .update(plans)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(plans.id, plan.id), inArray(plans.status, LIVE_STATUSES)))
    .returning();
  if (expired) {
    await logEvents(db, now, [{ planId: plan.id, actor: 'system', type: 'expired' }]);
    return expired;
  }
  // Changed meanwhile (cancelled, or expired by the sweep): read it again.
  const [fresh] = await db.select().from(plans).where(eq(plans.id, plan.id));
  return fresh ?? null;
}

export async function findPlanByShareToken(db: Db, shareToken: string, now: Date): Promise<PlanRow | null> {
  const [plan] = await db.select().from(plans).where(eq(plans.shareTokenHash, hashToken(shareToken)));
  return plan ? settle(db, plan, now) : null;
}

/** A plan of this creator: 404 when missing, 401/403 when the key does not open it (notCreator). */
export async function findCreatorPlan(db: Db, planId: string, key: CreatorKey, now: Date): Promise<PlanRow> {
  const [row] = await db.select().from(plans).where(eq(plans.id, planId));
  const plan = row ? await settle(db, row, now) : null;
  if (!plan) throw notFound();
  if (!isPlanCreator(plan, key)) throw notCreator(key);
  return plan;
}

/** The plan a manage link names, when its creator token is the plan's (retention applied); null otherwise. */
export async function findPlanByCreatorToken(db: Db, planId: string, creatorToken: string, now: Date): Promise<PlanRow | null> {
  const [row] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.creatorTokenHash, hashToken(creatorToken))));
  return row ? settle(db, row, now) : null;
}

export interface PlanSummary {
  id: string;
  title: string;
  activity: PlanRow['activity'];
  status: PlanStatus;
  voteDeadline: Date;
  createdAt: Date;
  participantCount: number;
  /** The sealed share token (open it with the ShareTokenBox), null for a link made before it was kept. */
  shareTokenEnc: string | null;
  /** The account that owns the plan, null while it lives in a browser only. */
  creatorSub: string | null;
}

/**
 * The plans a creator can manage, newest first (retention applied first): the account's own, and those whose creator
 * cookie this browser holds (each cookie checked against its plan's creator token).
 */
export async function listCreatorPlans(db: Db, owner: { sub: string | null; creatorTokens: Array<{ planId: string; token: string }> }, now: Date): Promise<PlanSummary[]> {
  const conditions: Array<SQL | undefined> = owner.creatorTokens.map(({ planId, token }) => and(eq(plans.id, planId), eq(plans.creatorTokenHash, hashToken(token))));
  if (owner.sub !== null) conditions.push(eq(plans.creatorSub, owner.sub));
  // No condition would select every plan: nobody to list for.
  const mine = conditions.length > 0 ? or(...conditions) : undefined;
  if (!mine) return [];
  await sweepPlans(db, now, mine);
  const counts = db
    .select({ planId: participants.planId, n: count().as('n') })
    .from(participants)
    .groupBy(participants.planId)
    .as('counts');
  const rows = await db
    .select({
      id: plans.id,
      title: plans.title,
      activity: plans.activity,
      status: plans.status,
      voteDeadline: plans.voteDeadline,
      createdAt: plans.createdAt,
      participantCount: counts.n,
      shareTokenEnc: plans.shareTokenEnc,
      creatorSub: plans.creatorSub,
    })
    .from(plans)
    .leftJoin(counts, eq(counts.planId, plans.id))
    .where(mine)
    .orderBy(desc(plans.createdAt))
    .limit(200);
  return rows.map((row) => ({ ...row, participantCount: Number(row.participantCount ?? 0) }));
}

/**
 * Retention for every plan (or those `mine` selects): expires open and locked plans READ_ONLY_AFTER_DAYS past their
 * deadline and deletes plans DELETE_AFTER_DAYS past it, with their options, participants, votes and log.
 */
export async function sweepPlans(db: Db, now: Date, mine?: SQL): Promise<{ expired: number; deleted: number }> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(plans)
      .where(and(lte(plans.voteDeadline, deleteCutoff(now)), mine))
      .returning({ id: plans.id });
    const expired = await tx
      .update(plans)
      .set({ status: 'expired', updatedAt: now })
      .where(and(inArray(plans.status, LIVE_STATUSES), lte(plans.voteDeadline, readOnlyCutoff(now)), mine))
      .returning({ id: plans.id });
    await logEvents(
      tx,
      now,
      expired.map((row) => ({ planId: row.id, actor: 'system', type: 'expired' })),
    );
    return { expired: expired.length, deleted: deleted.length };
  });
}

/** Runs a creator action in a transaction holding the plan row FOR UPDATE, after the ownership and status checks. */
async function withCreatorPlan<T>(
  db: Db,
  planId: string,
  key: CreatorKey,
  action: PlanAction,
  now: Date,
  fn: (tx: Db, plan: PlanRow) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(plans).where(eq(plans.id, planId)).for('update');
    if (!plan || isPastDeletion(plan, now)) throw notFound();
    if (!isPlanCreator(plan, key)) throw notCreator(key);
    assertCanDo(action, plan, now);
    return fn(tx, plan);
  });
}

function sameOption(row: OptionRow, input: OptionInput): boolean {
  const startsAt = input.kind === 'time' ? input.startsAt.getTime() : null;
  const mapUrl = input.kind === 'place' ? input.mapUrl : null;
  return row.label === input.label && (row.startsAt?.getTime() ?? null) === startsAt && row.mapUrl === mapUrl;
}

/**
 * Applies the full new option list. An edited option loses its votes (people approved the old wording), a removed
 * one goes with its votes, a new one is added; each is logged.
 */
async function replaceOptions(tx: Db, plan: PlanRow, inputs: OptionInput[], now: Date): Promise<void> {
  const existing = await tx.select().from(planOptions).where(eq(planOptions.planId, plan.id));
  const byId = new Map(existing.map((row) => [row.id, row]));
  for (const input of inputs) {
    const row = input.id ? byId.get(input.id) : undefined;
    if (input.id && (!row || row.kind !== input.kind)) throw new HttpError(400, 'invalid-option');
  }
  const keptIds = new Set(inputs.flatMap((input) => (input.id ? [input.id] : [])));
  const removed = existing.filter((row) => !keptIds.has(row.id));
  const events: EventInput[] = removed.map((row) => ({ planId: plan.id, actor: 'creator', type: 'option_removed', payload: { optionId: row.id } }));
  if (removed.length > 0) {
    await tx.delete(planOptions).where(
      inArray(
        planOptions.id,
        removed.map((row) => row.id),
      ),
    );
  }
  const rows = optionRows(plan.id, inputs);
  for (const [index, input] of inputs.entries()) {
    const values = rows[index];
    if (!values) continue;
    const row = input.id ? byId.get(input.id) : undefined;
    if (!row) {
      const [added] = await tx.insert(planOptions).values(values).returning({ id: planOptions.id });
      events.push({ planId: plan.id, actor: 'creator', type: 'option_added', payload: { optionId: added?.id ?? '' } });
      continue;
    }
    if (!sameOption(row, input)) {
      const cleared = await tx.delete(votes).where(eq(votes.optionId, row.id)).returning({ participantId: votes.participantId });
      events.push({ planId: plan.id, actor: 'creator', type: 'option_edited', payload: { optionId: row.id, clearedVotes: cleared.length } });
    }
    await tx
      .update(planOptions)
      .set({ label: values.label, mapUrl: values.mapUrl, startsAt: values.startsAt, sortOrder: values.sortOrder })
      .where(eq(planOptions.id, row.id));
  }
  await logEvents(tx, now, events);
}

export async function updatePlan(db: Db, planId: string, key: CreatorKey, input: UpdatePlanInput, now: Date): Promise<void> {
  await withCreatorPlan(db, planId, key, 'edit', now, async (tx, plan) => {
    if (input.voteDeadline) assertDeadline(input.voteDeadline, now);
    const { options, ...fields } = input;
    const changed = Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    if (changed.length > 0) {
      await tx
        .update(plans)
        .set({ ...fields, updatedAt: now })
        .where(eq(plans.id, plan.id));
      await logEvents(tx, now, [{ planId: plan.id, actor: 'creator', type: 'plan_edited', payload: { fields: changed } }]);
    }
    if (options) {
      await replaceOptions(tx, plan, options, now);
      if (changed.length === 0) await tx.update(plans).set({ updatedAt: now }).where(eq(plans.id, plan.id));
    }
  });
}

/**
 * Locks the plan in: one time and one place, required for each kind the plan has options of. Ties are the
 * creator's call; the server never picks.
 */
export async function lockPlan(
  db: Db,
  planId: string,
  key: CreatorKey,
  choice: { timeOptionId?: string; placeOptionId?: string },
  now: Date,
): Promise<void> {
  await withCreatorPlan(db, planId, key, 'lock', now, async (tx, plan) => {
    const options = await tx.select({ id: planOptions.id, kind: planOptions.kind }).from(planOptions).where(eq(planOptions.planId, plan.id));
    const chosen: string[] = [];
    for (const [kind, id] of [
      ['time', choice.timeOptionId],
      ['place', choice.placeOptionId],
    ] as const) {
      const ofKind = options.filter((option) => option.kind === kind);
      if (id === undefined) {
        if (ofKind.length > 0) throw new HttpError(400, 'lock-choice-required');
        continue;
      }
      if (!ofKind.some((option) => option.id === id)) throw new HttpError(400, 'invalid-option');
      chosen.push(id);
    }
    await tx.update(plans).set({ status: 'locked', lockedOptionIds: chosen, lockedAt: now, updatedAt: now }).where(eq(plans.id, plan.id));
    await logEvents(tx, now, [{ planId: plan.id, actor: 'creator', type: 'locked', payload: { optionIds: chosen } }]);
  });
}

/** Cancel (open or locked) or mark done (locked). */
export async function finishPlan(db: Db, planId: string, key: CreatorKey, outcome: 'cancelled' | 'done', now: Date): Promise<void> {
  await withCreatorPlan(db, planId, key, outcome === 'done' ? 'done' : 'cancel', now, async (tx, plan) => {
    await tx.update(plans).set({ status: outcome, updatedAt: now }).where(eq(plans.id, plan.id));
    await logEvents(tx, now, [{ planId: plan.id, actor: 'creator', type: outcome }]);
  });
}

/** A new share link; the old one stops working at once. Guests keep their identity (their cookie is per plan). */
export async function rotateShareLink(db: Db, planId: string, key: CreatorKey, box: ShareTokenBox, now: Date): Promise<string> {
  const shareToken = newToken();
  await withCreatorPlan(db, planId, key, 'rotateLink', now, async (tx, plan) => {
    await tx
      .update(plans)
      .set({ shareTokenHash: hashToken(shareToken), shareTokenEnc: box.seal(shareToken, plan.id), updatedAt: now })
      .where(eq(plans.id, plan.id));
    await logEvents(tx, now, [{ planId: plan.id, actor: 'creator', type: 'link_rotated' }]);
  });
  return shareToken;
}

/**
 * Saves a plan to the signed-in account `sub`, for whoever holds its creator token: the account then manages it from
 * any browser (the token keeps working too). Idempotent for the account that owns it already; a plan owned by
 * another account is never taken (409 `plan-owned`). Allowed whatever the plan's status, until it is deleted.
 */
export async function claimPlan(db: Db, planId: string, sub: string, creatorToken: string | null, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [plan] = await tx.select().from(plans).where(eq(plans.id, planId)).for('update');
    if (!plan || isPastDeletion(plan, now)) throw notFound();
    if (plan.creatorSub === sub) return;
    if (!isPlanCreator(plan, { sub: null, creatorToken })) throw new HttpError(403, 'not-creator');
    if (plan.creatorSub !== null) throw new HttpError(409, 'plan-owned');
    await tx.update(plans).set({ creatorSub: sub, updatedAt: now }).where(eq(plans.id, plan.id));
    await tx
      .update(participants)
      .set({ creatorSub: sub })
      .where(and(eq(participants.planId, plan.id), eq(participants.isCreator, true)));
    await logEvents(tx, now, [{ planId: plan.id, actor: 'creator', type: 'plan_claimed' }]);
  });
}

/** Runs a guest action in a transaction holding the plan of a share token FOR SHARE, after the status check. */
async function withLinkedPlan<T>(db: Db, shareToken: string, action: PlanAction, now: Date, fn: (tx: Db, plan: PlanRow) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(plans).where(eq(plans.shareTokenHash, hashToken(shareToken))).for('share');
    if (!plan || isPastDeletion(plan, now)) throw notFound();
    assertCanDo(action, plan, now);
    return fn(tx, plan);
  });
}

function participantWhere(plan: PlanRow, requester: Requester): ReturnType<typeof and> | null {
  if (isPlanCreator(plan, requester)) return and(eq(participants.planId, plan.id), eq(participants.isCreator, true));
  if (requester.guestToken === null) return null;
  return and(eq(participants.planId, plan.id), eq(participants.guestTokenHash, hashToken(requester.guestToken)));
}

/** The requester's participant id in the plan, or null when they have not joined. */
export async function findParticipantId(db: Db, plan: PlanRow, requester: Requester): Promise<string | null> {
  const where = participantWhere(plan, requester);
  if (!where) return null;
  const [row] = await db.select({ id: participants.id }).from(participants).where(where);
  return row?.id ?? null;
}

async function lockParticipant(tx: Db, plan: PlanRow, requester: Requester): Promise<ParticipantRow> {
  const where = participantWhere(plan, requester);
  const [row] = where ? await tx.select().from(participants).where(where).for('update') : [];
  if (!row) throw new HttpError(409, 'not-joined');
  return row;
}

/**
 * Joins the plan, or renames the requester when they already joined (same participant). The creator joins as the
 * plan's creator (recognised by account or creator token); anyone else by the guest token the route put in their
 * cookie. Logs `joined` once per participant.
 */
export async function joinPlan(db: Db, shareToken: string, requester: Requester, displayName: string, now: Date): Promise<PlanRow> {
  return withLinkedPlan(db, shareToken, 'join', now, async (tx, plan) => {
    const isCreator = isPlanCreator(plan, requester);
    if (!isCreator && requester.guestToken === null) throw new Error('joinPlan needs a guest token');
    const identity = isCreator ? { isCreator: true, creatorSub: plan.creatorSub } : { guestTokenHash: hashToken(requester.guestToken ?? '') };
    const [created] = await tx
      .insert(participants)
      .values({ planId: plan.id, displayName, joinedAt: now, ...identity })
      .onConflictDoNothing()
      .returning({ id: participants.id });
    if (created) {
      await logEvents(tx, now, [{ planId: plan.id, actor: isCreator ? 'creator' : 'participant', type: 'joined', participantId: created.id }]);
      return plan;
    }
    const where = participantWhere(plan, requester);
    const [renamed] = where ? await tx.update(participants).set({ displayName }).where(where).returning({ id: participants.id }) : [];
    // The token is taken by a participant of another plan: only a hand-edited cookie gets here.
    if (!renamed) throw new HttpError(409, 'guest-conflict');
    return plan;
  });
}

/**
 * Sets the requester's full set of approved options. The participant row is locked so two submissions of one
 * person run one after the other; the (participant, option) primary key keeps a double submit from duplicating.
 */
export async function setVotes(db: Db, shareToken: string, requester: Requester, optionIds: string[], now: Date): Promise<PlanRow> {
  return withLinkedPlan(db, shareToken, 'vote', now, async (tx, plan) => {
    const participant = await lockParticipant(tx, plan, requester);
    if (optionIds.length > 0) {
      const valid = await tx
        .select({ id: planOptions.id })
        .from(planOptions)
        .where(and(eq(planOptions.planId, plan.id), inArray(planOptions.id, optionIds)));
      if (valid.length !== optionIds.length) throw new HttpError(400, 'invalid-option');
    }
    await tx
      .delete(votes)
      .where(and(eq(votes.participantId, participant.id), optionIds.length > 0 ? notInArray(votes.optionId, optionIds) : undefined));
    if (optionIds.length > 0) {
      await tx
        .insert(votes)
        .values(optionIds.map((optionId) => ({ planId: plan.id, participantId: participant.id, optionId, createdAt: now })))
        .onConflictDoNothing();
      const [already] = await tx
        .select({ id: planEvents.id })
        .from(planEvents)
        .where(and(eq(planEvents.participantId, participant.id), eq(planEvents.type, 'voted')))
        .limit(1);
      if (!already) {
        const actor = participant.isCreator ? 'creator' : 'participant';
        await logEvents(tx, now, [{ planId: plan.id, actor, type: 'voted', participantId: participant.id }]);
      }
    }
    return plan;
  });
}

export async function setRsvp(db: Db, shareToken: string, requester: Requester, rsvp: Rsvp, now: Date): Promise<PlanRow> {
  return withLinkedPlan(db, shareToken, 'rsvp', now, async (tx, plan) => {
    const participant = await lockParticipant(tx, plan, requester);
    if (participant.rsvp === rsvp) return plan;
    await tx.update(participants).set({ rsvp }).where(eq(participants.id, participant.id));
    const actor = participant.isCreator ? 'creator' : 'participant';
    await logEvents(tx, now, [{ planId: plan.id, actor, type: 'rsvp', participantId: participant.id, payload: { rsvp } }]);
    return plan;
  });
}

/** A browser opened the link for the first time (it had no guest cookie for the plan). */
export async function recordLinkOpened(db: Db, planId: string, now: Date): Promise<void> {
  await logEvents(db, now, [{ planId, actor: 'visitor', type: 'link_opened' }]);
}
