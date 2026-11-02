/**
 * The creator's API (signed-in account): make plans, list them, read one, edit it, lock it in, cancel it, mark it
 * done, and change its share link. Every route answers 401 `sign-in-required` without a session and 403
 * `not-creator` for someone else's plan.
 */
import express, { type Request, type Response, type Router } from 'express';
import type { ServerConfig } from '../config';
import type { Db } from '../db/client';
import { requireAccountSub } from '../auth/require-user';
import { HttpError } from '../http-error';
import { hourlyLimit } from './hourly-limit';
import { CreatePlanInput, LockInput, PlanId, UpdatePlanInput, parseBody } from './plan-input';
import {
  type PlanRow,
  createPlan,
  findCreatorPlan,
  findJoinedPlanId,
  findParticipantId,
  finishPlan,
  listCreatorPlans,
  lockPlan,
  rotateShareLink,
  updatePlan,
} from './plan-store';
import { type PlanView, buildPlanView, summaryView } from './plan-view';
import { shareLink, storedShareLink } from './share-link';
import { type ShareTokenBox, shareTokenBox } from './share-token-box';
import { readAllGuestTokens } from './tokens';

export type { ShareLink } from './share-link';

export interface PlanRoutesOptions {
  config: ServerConfig;
  db: Db;
  now: () => Date;
  /** Seals and opens the stored share tokens (one per app, from config.shareTokenKey). */
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

/** The account the create limiter counts against, put there by the sign-in check that runs before it. */
function creatorSubOf(res: Response): string {
  const sub: unknown = res.locals.creatorSub;
  if (typeof sub !== 'string') throw new Error('creator sub missing before the create limit');
  return sub;
}

export function planRoutes({ config, db, now, box }: PlanRoutesOptions): Router {
  const router = express.Router();
  const createLimit = hourlyLimit(config.planCreateLimitPerHour, (_req, res) => `sub:${creatorSubOf(res)}`);

  router.use('/api/plans', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const creatorView = async (plan: PlanRow, creatorSub: string, at: Date): Promise<PlanView> => {
    const participantId = await findParticipantId(db, plan, { sub: creatorSub, guestToken: null });
    return buildPlanView(db, plan, { isCreator: true, participantId }, at, storedShareLink(box, config.publicOrigin, plan));
  };

  /** The creator's plan after a change, as the creator sees it. */
  const answerPlan = async (res: Response, planId: string, creatorSub: string, at: Date): Promise<void> => {
    const plan = await findCreatorPlan(db, planId, creatorSub, at);
    res.json({ plan: await creatorView(plan, creatorSub, at) });
  };

  router.post(
    '/api/plans',
    async (req, res, next) => {
      res.locals.creatorSub = await requireAccountSub(req, config, db, now());
      next();
    },
    createLimit,
    async (req, res) => {
      const creatorSub = creatorSubOf(res);
      const input = parseBody(CreatePlanInput, req.body);
      const at = now();
      const sourcePlanId = await findJoinedPlanId(db, readAllGuestTokens(req, config));
      const { plan, shareToken } = await createPlan(db, { creatorSub, input, sourcePlanId, box, now: at });
      res.status(201).json({ plan: await creatorView(plan, creatorSub, at), share: shareLink(config.publicOrigin, shareToken) });
    },
  );

  router.get('/api/plans', async (req, res) => {
    const at = now();
    const creatorSub = await requireAccountSub(req, config, db, at);
    const plans = await listCreatorPlans(db, creatorSub, at);
    res.json({ plans: plans.map((summary) => summaryView(summary, storedShareLink(box, config.publicOrigin, summary))) });
  });

  router.get('/api/plans/:id', async (req, res) => {
    const at = now();
    const creatorSub = await requireAccountSub(req, config, db, at);
    await answerPlan(res, planIdParam(req), creatorSub, at);
  });

  router.patch('/api/plans/:id', async (req, res) => {
    const at = now();
    const creatorSub = await requireAccountSub(req, config, db, at);
    const planId = planIdParam(req);
    await updatePlan(db, planId, creatorSub, parseBody(UpdatePlanInput, req.body), at);
    await answerPlan(res, planId, creatorSub, at);
  });

  router.post('/api/plans/:id/lock', async (req, res) => {
    const at = now();
    const creatorSub = await requireAccountSub(req, config, db, at);
    const planId = planIdParam(req);
    await lockPlan(db, planId, creatorSub, parseBody(LockInput, req.body), at);
    await answerPlan(res, planId, creatorSub, at);
  });

  for (const [path, outcome] of [
    ['cancel', 'cancelled'],
    ['done', 'done'],
  ] as const) {
    router.post(`/api/plans/:id/${path}`, async (req, res) => {
      const at = now();
      const creatorSub = await requireAccountSub(req, config, db, at);
      const planId = planIdParam(req);
      await finishPlan(db, planId, creatorSub, outcome, at);
      await answerPlan(res, planId, creatorSub, at);
    });
  }

  router.post('/api/plans/:id/rotate-link', async (req, res) => {
    const at = now();
    const creatorSub = await requireAccountSub(req, config, db, at);
    const token = await rotateShareLink(db, planIdParam(req), creatorSub, box, at);
    res.json({ share: shareLink(config.publicOrigin, token) });
  });

  return router;
}
