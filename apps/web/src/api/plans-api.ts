/** The plan API (docs/plans-api.md), its answers checked at the boundary. */
import * as z from 'zod/mini';
import { ApiError, BAD_RESPONSE, apiFetch } from './api-client';

export const ACTIVITIES = ['coffee', 'dinner', 'movie', 'karaoke', 'day_trip', 'birthday', 'lunch', 'party', 'team_building', 'meeting', 'other'] as const;
export type Activity = (typeof ACTIVITIES)[number];
export const RSVPS = ['going', 'maybe', 'no'] as const;
export type Rsvp = (typeof RSVPS)[number];

const ShareLinkSchema = z.object({ token: z.string(), url: z.string() });
export type ShareLink = z.infer<typeof ShareLinkSchema>;

const OptionSchema = z.object({
  id: z.string(),
  kind: z.enum(['time', 'place']),
  label: z.string(),
  mapUrl: z.nullable(z.string()),
  startsAt: z.nullable(z.string()),
  votes: z.number(),
});
export type PlanOption = z.infer<typeof OptionSchema>;

const ParticipantSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  rsvp: z.nullable(z.enum(RSVPS)),
  isCreator: z.boolean(),
  optionIds: z.array(z.string()),
});
export type Participant = z.infer<typeof ParticipantSchema>;

const PlanStatusSchema = z.enum(['open', 'locked', 'done', 'cancelled', 'expired']);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

const PlanViewSchema = z.object({
  id: z.optional(z.string()),
  share: z.optional(z.nullable(ShareLinkSchema)),
  title: z.string(),
  activity: z.enum(ACTIVITIES),
  area: z.nullable(z.string()),
  budgetPerPerson: z.nullable(z.number()),
  groupSize: z.nullable(z.number()),
  voteDeadline: z.string(),
  readOnlyAt: z.string(),
  status: PlanStatusSchema,
  creatorName: z.nullable(z.string()),
  lockedOptionIds: z.array(z.string()),
  options: z.array(OptionSchema),
  participants: z.array(ParticipantSchema),
  viewer: z.object({ isCreator: z.boolean(), participantId: z.nullable(z.string()) }),
  can: z.object({
    join: z.boolean(),
    vote: z.boolean(),
    rsvp: z.boolean(),
    edit: z.boolean(),
    lock: z.boolean(),
    cancel: z.boolean(),
    done: z.boolean(),
    rotateLink: z.boolean(),
  }),
});
export type PlanView = z.infer<typeof PlanViewSchema>;

const PlanAnswer = z.object({ plan: PlanViewSchema });
const CreatedAnswer = z.object({ plan: PlanViewSchema, share: ShareLinkSchema });
const ShareAnswer = z.object({ share: ShareLinkSchema });
const SummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  activity: z.enum(ACTIVITIES),
  status: PlanStatusSchema,
  voteDeadline: z.string(),
  createdAt: z.string(),
  participantCount: z.number(),
  shareUrl: z.nullable(z.string()),
});
export type PlanSummary = z.infer<typeof SummarySchema>;
const ListAnswer = z.object({ plans: z.array(SummarySchema) });

async function call<T>(schema: z.ZodMiniType<T>, path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, BAD_RESPONSE);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(res.status, BAD_RESPONSE);
  return parsed.data;
}

const post = (body: unknown = {}): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const guestPath = (token: string, rest = ''): string => `/api/k/${encodeURIComponent(token)}${rest}`;
const planPath = (id: string, rest = ''): string => `/api/plans/${encodeURIComponent(id)}${rest}`;

export interface CreatePlanInput {
  title: string;
  activity: Activity;
  area?: string;
  budgetPerPerson?: number;
  groupSize?: number;
  voteDeadline: string;
  options: Array<{ kind: 'time'; startsAt: string } | { kind: 'place'; label: string; mapUrl?: string }>;
  creatorDisplayName?: string;
}

export const fetchGuestPlan = async (token: string): Promise<PlanView> => (await call(PlanAnswer, guestPath(token))).plan;
export const joinPlan = async (token: string, displayName: string): Promise<PlanView> => (await call(PlanAnswer, guestPath(token, '/join'), post({ displayName }))).plan;
export const sendVotes = async (token: string, optionIds: string[]): Promise<PlanView> => (await call(PlanAnswer, guestPath(token, '/votes'), post({ optionIds }))).plan;
export const sendRsvp = async (token: string, rsvp: Rsvp): Promise<PlanView> => (await call(PlanAnswer, guestPath(token, '/rsvp'), post({ rsvp }))).plan;

export const createPlan = (input: CreatePlanInput): Promise<{ plan: PlanView; share: ShareLink }> => call(CreatedAnswer, '/api/plans', post(input));
export const listPlans = async (): Promise<PlanSummary[]> => (await call(ListAnswer, '/api/plans')).plans;
export const fetchCreatorPlan = async (id: string): Promise<PlanView> => (await call(PlanAnswer, planPath(id))).plan;
export const lockPlan = async (id: string, choice: { timeOptionId?: string; placeOptionId?: string }): Promise<PlanView> =>
  (await call(PlanAnswer, planPath(id, '/lock'), post(choice))).plan;
export const cancelPlan = async (id: string): Promise<PlanView> => (await call(PlanAnswer, planPath(id, '/cancel'), post())).plan;
export const markDone = async (id: string): Promise<PlanView> => (await call(PlanAnswer, planPath(id, '/done'), post())).plan;
export const rotateLink = async (id: string): Promise<ShareLink> => (await call(ShareAnswer, planPath(id, '/rotate-link'), post())).share;

/** The path of a share link (/k/<token>) from its full URL. */
export function sharePath(url: string): string {
  return new URL(url, window.location.origin).pathname;
}
