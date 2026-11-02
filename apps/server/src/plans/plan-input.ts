/** Request bodies of the plan API, validated at the boundary. A failed parse answers 400 `invalid-body`. */
import { z } from 'zod';
import { ACTIVITIES, type OptionKind, RSVPS } from '../db/schema';
import { HttpError } from '../http-error';
import { isGoogleMapsLink } from './map-link';

export const MAX_OPTIONS_PER_KIND = 10;
/** Longest vote window a plan can be given (from now). */
export const MAX_DEADLINE_DAYS = 60;

// Control characters (including newlines) have no place in a one-line name or label.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Trimmed single-line text of 1..max characters. */
const line = (max: number): z.ZodType<string> =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !CONTROL.test(value));

/** Optional single-line text: empty or missing is null. */
const optionalLine = (max: number): z.ZodType<string | null> =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !CONTROL.test(value))
    .nullish()
    .transform((value) => (value ? value : null));

const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const TimeOption = z.strictObject({
  id: z.uuid().optional(),
  kind: z.literal('time'),
  startsAt: instant,
  /** Optional words next to the time ("after work"). */
  label: optionalLine(60).transform((value) => value ?? ''),
});

const PlaceOption = z.strictObject({
  id: z.uuid().optional(),
  kind: z.literal('place'),
  /** The place's name. */
  label: line(300),
  /** A pasted Google Maps link of the place (https on Google's map hosts only); null or missing for none. */
  mapUrl: z
    .string()
    .trim()
    .refine(isGoogleMapsLink)
    .nullish()
    .transform((value) => value ?? null),
});

const OptionInput = z.discriminatedUnion('kind', [TimeOption, PlaceOption]);
export type OptionInput = z.infer<typeof OptionInput>;

const Options = z
  .array(OptionInput)
  .min(1)
  .max(MAX_OPTIONS_PER_KIND * 2)
  .refine((options) => (['time', 'place'] as const).every((kind: OptionKind) => options.filter((o) => o.kind === kind).length <= MAX_OPTIONS_PER_KIND))
  .refine((options) => {
    const ids = options.flatMap((o) => (o.id ? [o.id] : []));
    return new Set(ids).size === ids.length;
  });

const DisplayName = line(40);

const planFields = {
  title: line(80),
  activity: z.enum(ACTIVITIES),
  area: optionalLine(80),
  budgetPerPerson: z.number().int().min(0).max(100_000_000).nullish().transform((value) => value ?? null),
  /** How many people the creator expects in the group; null when not said. */
  groupSize: z.number().int().min(2).max(50).nullish().transform((value) => value ?? null),
  voteDeadline: instant,
};

export const CreatePlanInput = z.strictObject({
  ...planFields,
  options: Options,
  /** The creator's name in the plan; given, the creator joins it at once (the web app pre-fills the account name). */
  creatorDisplayName: DisplayName.optional(),
});
export type CreatePlanInput = z.infer<typeof CreatePlanInput>;

/** Every field optional; `options`, when given, is the full new list (an option without `id` is new). */
export const UpdatePlanInput = z.strictObject({
  title: planFields.title.optional(),
  activity: planFields.activity.optional(),
  area: planFields.area.optional(),
  budgetPerPerson: planFields.budgetPerPerson.optional(),
  groupSize: planFields.groupSize.optional(),
  voteDeadline: planFields.voteDeadline.optional(),
  options: Options.optional(),
});
export type UpdatePlanInput = z.infer<typeof UpdatePlanInput>;

export const LockInput = z.strictObject({
  timeOptionId: z.uuid().optional(),
  placeOptionId: z.uuid().optional(),
});

export const JoinInput = z.strictObject({ displayName: DisplayName });

export const VotesInput = z.strictObject({
  /** The full set of options the person approves of; an empty list withdraws every vote. */
  optionIds: z
    .array(z.uuid())
    .max(MAX_OPTIONS_PER_KIND * 2)
    .refine((ids) => new Set(ids).size === ids.length),
});

export const RsvpInput = z.strictObject({ rsvp: z.enum(RSVPS) });

/** Route ids are uuids; anything else cannot name a plan, so it is the same 404 as a missing one. */
export const PlanId = z.uuid();

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, 'invalid-body');
  return parsed.data;
}

/** A vote deadline must be in the future and at most MAX_DEADLINE_DAYS away. */
export function assertDeadline(deadline: Date, now: Date): void {
  const max = now.getTime() + MAX_DEADLINE_DAYS * 24 * 60 * 60 * 1000;
  if (deadline.getTime() <= now.getTime() || deadline.getTime() > max) throw new HttpError(400, 'invalid-deadline');
}
