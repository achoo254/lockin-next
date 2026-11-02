/**
 * What the API answers about a plan. Anyone with the link sees the plan, its options with vote counts, and the
 * display names, votes and going/not of the people who joined (as the privacy page says). Never in it: the
 * creator's account (sub or profile), token hashes, exact join times. The plan id and its share link only go to its
 * creator.
 */
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { type Activity, type OptionKind, type PlanStatus, type Rsvp, participants, planOptions, votes } from '../db/schema';
import { type PlanAction, canDo, readOnlyAt } from './plan-rules';
import type { PlanRow, PlanSummary } from './plan-store';
import type { ShareLink } from './share-link';

export interface OptionView {
  id: string;
  kind: OptionKind;
  label: string;
  /** The pasted Google Maps link of a place, null when none. */
  mapUrl: string | null;
  /** ISO time (UTC) of a time option, null for a place. */
  startsAt: string | null;
  votes: number;
}

export interface ParticipantView {
  id: string;
  displayName: string;
  rsvp: Rsvp | null;
  isCreator: boolean;
  optionIds: string[];
}

export interface PlanView {
  /** Only for the creator (the creator routes take it). */
  id?: string;
  /** Only for the creator: the link to send to the group, null when it cannot be shown again (rotate it). */
  share?: ShareLink | null;
  title: string;
  activity: Activity;
  area: string | null;
  budgetPerPerson: number | null;
  /** How many people the creator expects, null when not said. */
  groupSize: number | null;
  voteDeadline: string;
  /** When the plan turns read-only if it is still open or locked then. */
  readOnlyAt: string;
  status: PlanStatus;
  /** The creator's display name in the plan, null until the creator joins it. */
  creatorName: string | null;
  lockedOptionIds: string[];
  options: OptionView[];
  participants: ParticipantView[];
  viewer: {
    isCreator: boolean;
    /** The viewer's participant id, null before joining. */
    participantId: string | null;
  };
  /** What the viewer can do now (creator actions are false for everyone else). */
  can: Record<PlanAction, boolean>;
}

const CREATOR_ACTIONS: PlanAction[] = ['edit', 'lock', 'cancel', 'done', 'rotateLink'];
const KIND_ORDER: Record<OptionKind, number> = { time: 0, place: 1 };

/** `creatorShare`: the plan's link, included only when the viewer is its creator. */
export async function buildPlanView(
  db: Db,
  plan: PlanRow,
  viewer: { isCreator: boolean; participantId: string | null },
  now: Date,
  creatorShare: ShareLink | null = null,
): Promise<PlanView> {
  const [options, people, ballots] = await Promise.all([
    db.select().from(planOptions).where(eq(planOptions.planId, plan.id)),
    db.select().from(participants).where(eq(participants.planId, plan.id)).orderBy(asc(participants.joinedAt), asc(participants.id)),
    db.select({ participantId: votes.participantId, optionId: votes.optionId }).from(votes).where(eq(votes.planId, plan.id)),
  ]);
  const tally = new Map<string, number>();
  const byParticipant = new Map<string, string[]>();
  for (const ballot of ballots) {
    tally.set(ballot.optionId, (tally.get(ballot.optionId) ?? 0) + 1);
    byParticipant.set(ballot.participantId, [...(byParticipant.get(ballot.participantId) ?? []), ballot.optionId]);
  }
  const allowed = (action: PlanAction): boolean => (viewer.isCreator || !CREATOR_ACTIONS.includes(action)) && canDo(action, plan, now);
  const can: Record<PlanAction, boolean> = {
    join: allowed('join'),
    vote: allowed('vote'),
    rsvp: allowed('rsvp'),
    edit: allowed('edit'),
    lock: allowed('lock'),
    cancel: allowed('cancel'),
    done: allowed('done'),
    rotateLink: allowed('rotateLink'),
  };
  return {
    ...(viewer.isCreator ? { id: plan.id, share: creatorShare } : {}),
    title: plan.title,
    activity: plan.activity,
    area: plan.area,
    budgetPerPerson: plan.budgetPerPerson,
    groupSize: plan.groupSize,
    voteDeadline: plan.voteDeadline.toISOString(),
    readOnlyAt: readOnlyAt(plan.voteDeadline).toISOString(),
    status: plan.status,
    creatorName: people.find((person) => person.creatorSub !== null)?.displayName ?? null,
    lockedOptionIds: plan.lockedOptionIds ?? [],
    options: options
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.sortOrder - b.sortOrder)
      .map((option) => ({
        id: option.id,
        kind: option.kind,
        label: option.label,
        mapUrl: option.mapUrl,
        startsAt: option.startsAt?.toISOString() ?? null,
        votes: tally.get(option.id) ?? 0,
      })),
    participants: people.map((person) => ({
      id: person.id,
      displayName: person.displayName,
      rsvp: person.rsvp,
      isCreator: person.creatorSub !== null,
      optionIds: byParticipant.get(person.id) ?? [],
    })),
    viewer,
    can,
  };
}

export interface PlanSummaryView {
  id: string;
  title: string;
  activity: Activity;
  status: PlanStatus;
  voteDeadline: string;
  createdAt: string;
  participantCount: number;
  /** The plan's link (the list is the creator's own), null when it cannot be shown again. */
  shareUrl: string | null;
}

export function summaryView(summary: PlanSummary, share: ShareLink | null): PlanSummaryView {
  return {
    id: summary.id,
    title: summary.title,
    activity: summary.activity,
    status: summary.status,
    voteDeadline: summary.voteDeadline.toISOString(),
    createdAt: summary.createdAt.toISOString(),
    participantCount: summary.participantCount,
    shareUrl: share?.url ?? null,
  };
}
