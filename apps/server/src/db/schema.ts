import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * An account of the hoandat.com IdP that signed in here: its `sub`, and the name, email and picture its userinfo
 * gave at the latest sign-in (scope `openid profile email`), shown in the header's account menu. The three are
 * null for an account whose userinfo gave none.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  sub: text('sub').notNull().unique(),
  name: text('name'),
  email: text('email'),
  picture: text('picture'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** Web sessions. `id` is the sha256 of the opaque cookie token, never the token itself. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

/** What a plan is for (friends first, then work groups); the web app pre-fills the title from it. */
export const ACTIVITIES = [
  'coffee',
  'dinner',
  'movie',
  'karaoke',
  'day_trip',
  'birthday',
  'lunch',
  'party',
  'team_building',
  'meeting',
  'other',
] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** `open` → `locked` → `done`; `cancelled` and `expired` end a plan (see plans/plan-rules.ts). */
export const PLAN_STATUSES = ['open', 'locked', 'done', 'cancelled', 'expired'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const OPTION_KINDS = ['time', 'place'] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

export const RSVPS = ['going', 'maybe', 'no'] as const;
export type Rsvp = (typeof RSVPS)[number];

/** Who did what in a plan's log; never a guest's name (the privacy page promises it). */
export const EVENT_ACTORS = ['creator', 'participant', 'visitor', 'system'] as const;
export type EventActor = (typeof EVENT_ACTORS)[number];

const sqlList = (values: readonly string[]): ReturnType<typeof sql.raw> => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * A plan. Its creator is an account (`creator_sub`, the IdP subject; null for a plan made signed out and not saved to
 * an account yet) and/or whoever holds the creator token (`creator_token_hash`: the sha256 of the token in the
 * creator's browser cookie and in the private manage link; null for plans made before that). The share link and the
 * manage link carry random tokens: looked up by their sha256, and kept AES-256-GCM encrypted (`share_token_enc`,
 * `manage_token_enc`, plans/share-token-box.ts) so the creator can see them again; null when made before that.
 * All times are UTC. `locked_option_ids`: the time and/or place the creator locked in.
 */
export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorSub: text('creator_sub'),
    creatorTokenHash: text('creator_token_hash').unique(),
    manageTokenEnc: text('manage_token_enc'),
    title: text('title').notNull(),
    activity: text('activity').$type<Activity>().notNull(),
    area: text('area'),
    /** VND per person, the creator's estimate. */
    budgetPerPerson: integer('budget_per_person'),
    /** How many people the creator expects (2–50), to tell the group how many have not voted yet. */
    groupSize: integer('group_size'),
    /** The names of the people the creator expects (at most 50, no repeats), to tell who has not voted yet. */
    memberNames: text('member_names').array().notNull().default(sql`'{}'::text[]`),
    voteDeadline: timestamp('vote_deadline', { withTimezone: true }).notNull(),
    status: text('status').$type<PlanStatus>().notNull().default('open'),
    shareTokenHash: text('share_token_hash').notNull().unique(),
    shareTokenEnc: text('share_token_enc'),
    lockedOptionIds: uuid('locked_option_ids').array(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('plans_creator_sub_idx').on(table.creatorSub, table.createdAt),
    index('plans_vote_deadline_idx').on(table.voteDeadline),
    check('plans_status_check', sql`${table.status} in (${sqlList(PLAN_STATUSES)})`),
    check('plans_activity_check', sql`${table.activity} in (${sqlList(ACTIVITIES)})`),
    check('plans_group_size_check', sql`${table.groupSize} is null or ${table.groupSize} between 2 and 50`),
  ],
);

/**
 * A time (`starts_at`, label optional) or a place (label: its name) people vote for. A place may carry a pasted
 * Google Maps link (`map_url`, checked by plans/map-link.ts).
 */
export const planOptions = pgTable(
  'plan_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<OptionKind>().notNull(),
    label: text('label').notNull().default(''),
    mapUrl: text('map_url'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    sortOrder: integer('sort_order').notNull(),
  },
  (table) => [
    index('plan_options_plan_id_idx').on(table.planId),
    check('plan_options_kind_check', sql`${table.kind} in (${sqlList(OPTION_KINDS)})`),
    check('plan_options_time_check', sql`(${table.kind} = 'time') = (${table.startsAt} is not null)`),
  ],
);

/**
 * Someone in a plan: a guest (recognised by the sha256 of the token in their browser cookie) or the plan's creator
 * (`is_creator`, one per plan; recognised as the plan's creator is, by account or creator token). `creator_sub` on the
 * creator's row is the account that owns the plan, when there is one. Renaming keeps the row; another browser is
 * another participant. A BEFORE INSERT trigger (migration 0003, not in this schema) marks a row inserted with
 * `creator_sub` and no guest token as the creator, so the previous release, which never sets `is_creator`, still
 * works on this schema after a rollback.
 */
export const participants = pgTable(
  'participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    guestTokenHash: text('guest_token_hash').unique(),
    creatorSub: text('creator_sub'),
    isCreator: boolean('is_creator').notNull().default(false),
    rsvp: text('rsvp').$type<Rsvp>(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('participants_plan_id_idx').on(table.planId, table.joinedAt),
    unique('participants_plan_creator_unique').on(table.planId, table.creatorSub),
    uniqueIndex('participants_one_creator_idx').on(table.planId).where(sql`${table.isCreator}`),
    check('participants_identity_check', sql`(${table.guestTokenHash} is null) = ${table.isCreator}`),
    check('participants_creator_sub_check', sql`${table.creatorSub} is null or ${table.isCreator}`),
    check('participants_rsvp_check', sql`${table.rsvp} is null or ${table.rsvp} in (${sqlList(RSVPS)})`),
  ],
);

/** One approval of an option by a participant; the primary key makes a double submit harmless. */
export const votes = pgTable(
  'votes',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => planOptions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.participantId, table.optionId] }), index('votes_option_id_idx').on(table.optionId)],
);

/**
 * A plan's log and the source of the funnel numbers (`pnpm stats`). Holds participant ids, never names.
 * `source_plan_id` on `plan_created`: the creator's browser had joined that other plan as a guest; its payload
 * `creatorKind` says whether it was made signed in (`account`) or signed out (`guest`). `plan_claimed`: a plan made
 * signed out was saved to an account.
 */
export const planEvents = pgTable(
  'plan_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    actor: text('actor').$type<EventActor>().notNull(),
    participantId: uuid('participant_id').references(() => participants.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, string | number | boolean | string[]>>(),
    sourcePlanId: uuid('source_plan_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('plan_events_plan_id_idx').on(table.planId, table.createdAt),
    index('plan_events_type_idx').on(table.type, table.createdAt),
    check('plan_events_actor_check', sql`${table.actor} in (${sqlList(EVENT_ACTORS)})`),
  ],
);
