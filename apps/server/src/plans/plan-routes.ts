/**
 * The creator's API: make plans, list them, read one, edit it, lock it in, cancel it, mark it done, change its share
 * link or its manage link, and save it to an account. Anyone can make a plan, signed in or not. The creator is the
 * account that owns the plan; a plan made signed out and not saved to an account yet is run by whoever holds its
 * creator token: the HttpOnly creator cookie of the browser that made it, or the private manage link
 * (GET /m/<plan id>.<token>), which puts that cookie in the browser that opens it. Once the plan is saved to an
 * account, the account is the only key (plan-store.ts isPlanCreator).
 *
 * Creator routes answer 401 `sign-in-required` to someone signed out who is not the plan's creator and 403
 * `not-creator` to an account that is not.
 */
import express, { type Request, type Response, type Router } from 'express';
import type { ServerConfig } from '../config';
import type { Db } from '../db/client';
import { findAccountSub, requireAccountSub } from '../auth/require-user';
import { HttpError } from '../http-error';
import { dailyLimit, hourlyLimit } from './hourly-limit';
import { ClaimInput, CreatePlanInput, LockInput, PlanId, UpdatePlanInput, parseBody } from './plan-input';
import { putCreatorCookie } from './plan-cookie-room';
import { deleteAt } from './plan-rules';
import {
  type CreatorKey,
  type PlanRow,
  claimPlan,
  createPlan,
  findCreatorPlan,
  findJoinedPlanId,
  findParticipantId,
  findPlanByCreatorToken,
  finishPlan,
  isPlanCreator,
  listCreatorPlans,
  lockPlan,
  rotateManageLink,
  rotateShareLink,
  updatePlan,
} from './plan-store';
import { type CreatorLinks, type PlanView, buildPlanView, summaryView } from './plan-view';
import { manageLink, shareLink, storedManageLink, storedShareLink } from './share-link';
import { type ShareTokenBox, shareTokenBox } from './share-token-box';
import { clearPlanCookie, isTokenShape, readAllCreatorTokens, readAllGuestTokens, readCreatorToken } from './tokens';

export type { ManageLink, ShareLink } from './share-link';

export interface PlanRoutesOptions {
  config: ServerConfig;
  db: Db;
  now: () => Date;
  /** Seals and opens the stored share and creator tokens (one per app, from config.shareTokenKey). */
  box: ShareTokenBox;
}

/** The box of the app's share-token key. */
export function shareTokenBoxOf(config: ServerConfig): ShareTokenBox {
  return shareTokenBox(config.shareTokenKey);
}

/** The `:id` of a creator route; anything but a uuid cannot name a plan (same 404 as a missing one). */
function planIdParam(req: Request): string {
  const parsed = PlanId.safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(404, 'not-found');
  return parsed.data;
}

/** The account (or null, signed out) a create request comes from, put there by the session check that runs first. */
function creatorSubOf(res: Response): string | null {
  const sub: unknown = res.locals.creatorSub;
  if (sub !== null && typeof sub !== 'string') throw new Error('creator sub missing before the create limit');
  return sub;
}

/** `<plan id>.<creator token>` of a manage link; null for anything else. */
export function parseManageLink(value: unknown): { planId: string; token: string } | null {
  if (typeof value !== 'string') return null;
  const dot = value.indexOf('.');
  const planId = PlanId.safeParse(value.slice(0, dot));
  const token = value.slice(dot + 1);
  return dot > 0 && planId.success && isTokenShape(token) ? { planId: planId.data, token } : null;
}

/** The plan's share and manage links, for its creator. */
export function creatorLinks(box: ShareTokenBox, config: ServerConfig, plan: PlanRow): CreatorLinks {
  return { share: storedShareLink(box, config.publicOrigin, plan), manage: storedManageLink(box, config.publicOrigin, plan) };
}

/**
 * (Re)sets the creator cookie of a request that is the creator by the plan's creator token (a plan not saved to an
 * account), until the plan is deleted: its lifetime follows the plan's deadline when the creator moves it.
 */
export async function keepCreatorCookie(db: Db, req: Request, res: Response, config: ServerConfig, plan: PlanRow, key: CreatorKey, at: Date): Promise<void> {
  const token = key.creatorToken;
  if (typeof token !== 'string' || plan.creatorSub !== null || !isPlanCreator(plan, { sub: null, creatorToken: token })) return;
  await putCreatorCookie(db, req, res, config, { planId: plan.id, token }, deleteAt(plan.voteDeadline), at);
}

export function planRoutes({ config, db, now, box }: PlanRoutesOptions): Router {
  const router = express.Router();
  const signedIn = (_req: Request, res: Response): boolean => creatorSubOf(res) !== null;
  const signedOut = (req: Request, res: Response): boolean => !signedIn(req, res);
  // Signed in: per account. Signed out: per client IP, an hourly limit under a daily ceiling.
  const accountCreateLimit = hourlyLimit(config.planCreateLimitPerHour, (_req, res) => `sub:${creatorSubOf(res) ?? ''}`, signedOut);
  const guestCreateLimit = hourlyLimit(config.guestPlanCreateLimitPerHourPerIp, undefined, signedIn);
  const guestCreateCeiling = dailyLimit(config.guestPlanCreateLimitPerDayPerIp, undefined, signedIn);

  router.use('/api/plans', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  /** Who may be the creator of plan `planId`; 401 at once when the request has neither a session nor its creator cookie. */
  const creatorKey = async (req: Request, planId: string, at: Date): Promise<CreatorKey> => {
    const key = { sub: await findAccountSub(req, config, db, at), creatorToken: readCreatorToken(req, config, planId) };
    if (key.sub === null && key.creatorToken === null) throw new HttpError(401, 'sign-in-required');
    return key;
  };

  const creatorView = async (plan: PlanRow, key: CreatorKey, at: Date): Promise<PlanView> => {
    const participantId = await findParticipantId(db, plan, { ...key, guestToken: null });
    return buildPlanView(db, plan, { isCreator: true, participantId }, at, creatorLinks(box, config, plan));
  };

  /** The creator's plan after a change, as the creator sees it. */
  const answerPlan = async (req: Request, res: Response, planId: string, key: CreatorKey, at: Date): Promise<void> => {
    const plan = await findCreatorPlan(db, planId, key, at);
    await keepCreatorCookie(db, req, res, config, plan, key, at);
    res.json({ plan: await creatorView(plan, key, at) });
  };

  router.post(
    '/api/plans',
    async (req, res, next) => {
      res.locals.creatorSub = await findAccountSub(req, config, db, now());
      next();
    },
    accountCreateLimit,
    guestCreateLimit,
    guestCreateCeiling,
    async (req, res) => {
      const creatorSub = creatorSubOf(res);
      const input = parseBody(CreatePlanInput, req.body);
      // Signed out, the name is how the group (and the creator) tell this plan's maker apart.
      if (creatorSub === null && !input.creatorDisplayName) throw new HttpError(400, 'name-required');
      const at = now();
      const sourcePlanId = await findJoinedPlanId(db, readAllGuestTokens(req, config));
      const { plan, shareToken, creatorToken } = await createPlan(db, { creatorSub, input, sourcePlanId, box, now: at });
      // Signed in, the account is the key; signed out, this browser's cookie (and the manage link) is.
      if (creatorToken !== null) await putCreatorCookie(db, req, res, config, { planId: plan.id, token: creatorToken }, deleteAt(plan.voteDeadline), at);
      res.status(201).json({
        plan: await creatorView(plan, { sub: creatorSub, creatorToken }, at),
        share: shareLink(config.publicOrigin, shareToken),
        manage: creatorToken === null ? null : manageLink(config.publicOrigin, plan.id, creatorToken),
      });
    },
  );

  router.get('/api/plans', async (req, res) => {
    const at = now();
    const sub = await findAccountSub(req, config, db, at);
    const plans = await listCreatorPlans(db, { sub, creatorTokens: readAllCreatorTokens(req, config) }, at);
    res.json({ plans: plans.map((summary) => summaryView(summary, storedShareLink(box, config.publicOrigin, summary))) });
  });

  router.get('/api/plans/:id', async (req, res) => {
    const at = now();
    const planId = planIdParam(req);
    await answerPlan(req, res, planId, await creatorKey(req, planId, at), at);
  });

  router.patch('/api/plans/:id', async (req, res) => {
    const at = now();
    const planId = planIdParam(req);
    const key = await creatorKey(req, planId, at);
    await updatePlan(db, planId, key, parseBody(UpdatePlanInput, req.body), at);
    await answerPlan(req, res, planId, key, at);
  });

  router.post('/api/plans/:id/lock', async (req, res) => {
    const at = now();
    const planId = planIdParam(req);
    const key = await creatorKey(req, planId, at);
    await lockPlan(db, planId, key, parseBody(LockInput, req.body), at);
    await answerPlan(req, res, planId, key, at);
  });

  for (const [path, outcome] of [
    ['cancel', 'cancelled'],
    ['done', 'done'],
  ] as const) {
    router.post(`/api/plans/:id/${path}`, async (req, res) => {
      const at = now();
      const planId = planIdParam(req);
      const key = await creatorKey(req, planId, at);
      await finishPlan(db, planId, key, outcome, at);
      await answerPlan(req, res, planId, key, at);
    });
  }

  router.post('/api/plans/:id/rotate-link', async (req, res) => {
    const at = now();
    const planId = planIdParam(req);
    const token = await rotateShareLink(db, planId, await creatorKey(req, planId, at), box, at);
    res.json({ share: shareLink(config.publicOrigin, token) });
  });

  // A new manage link: the old one, and the creator cookie of every other browser, stop working.
  router.post('/api/plans/:id/rotate-manage', async (req, res) => {
    const at = now();
    const planId = planIdParam(req);
    const key = await creatorKey(req, planId, at);
    const token = await rotateManageLink(db, planId, key, box, at);
    const plan = await findCreatorPlan(db, planId, { sub: key.sub, creatorToken: token }, at);
    // This browser keeps managing by cookie when that is how it got in (the plan has no account yet).
    await keepCreatorCookie(db, req, res, config, plan, { sub: null, creatorToken: token }, at);
    res.json({ manage: manageLink(config.publicOrigin, plan.id, token) });
  });

  // From here on the account is the plan's key: the creator token is replaced (claimPlan) and this browser's creator
  // cookie of the plan goes.
  router.post('/api/plans/:id/claim', async (req, res) => {
    const at = now();
    const sub = await requireAccountSub(req, config, db, at);
    const planId = planIdParam(req);
    const { token } = parseBody(ClaimInput, req.body);
    await claimPlan(db, planId, sub, token ?? readCreatorToken(req, config, planId), box, at);
    clearPlanCookie(res, config, 'c', planId);
    await answerPlan(req, res, planId, { sub }, at);
  });

  // The manage link: hands this browser the creator cookie, then goes to the plan without the token in the address. The
  // link of a plan saved to an account sets no cookie (the account is the key) and goes to the plan's creator page,
  // which asks to sign in: the link's holder may not be in the group, so the share link is not revealed.
  router.get('/m/:link', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
    const at = now();
    const link = parseManageLink(req.params.link);
    const plan = link ? await findPlanByCreatorToken(db, link.planId, link.token, at) : null;
    if (!link || !plan) {
      // Same answer for a wrong token, a malformed link and a deleted plan.
      res.redirect(303, '/?manage=invalid');
      return;
    }
    if (plan.creatorSub !== null) {
      res.redirect(303, `/plans/${plan.id}`);
      return;
    }
    await putCreatorCookie(db, req, res, config, { planId: plan.id, token: link.token }, deleteAt(plan.voteDeadline), at);
    const share = storedShareLink(box, config.publicOrigin, plan);
    res.redirect(303, share ? `/k/${share.token}` : `/plans/${plan.id}`);
  });

  return router;
}
