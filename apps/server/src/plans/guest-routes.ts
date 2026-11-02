/**
 * The plan page's API, for anyone holding the share link: read the plan, join with a display name (or rename),
 * vote, and say whether one goes. No account needed: a guest is the random token in an HttpOnly cookie for this
 * plan, handed out when they join (only reading the plan sets no cookie, so a browser does not pile up one cookie
 * per plan it merely looked at). The creator is recognised as on the creator routes instead: by account, or by the
 * plan's creator cookie.
 *
 * A wrong, rotated or malformed token is the same 404 `not-found` as a deleted plan.
 */
import express, { type Request, type Response, type Router } from 'express';
import { findAccountSub } from '../auth/require-user';
import { HttpError } from '../http-error';
import { dailyOpenDedupe } from './daily-open-dedupe';
import { hourlyLimit, hourlyQuota, ipAndLinkKey, overHourlyQuota } from './hourly-limit';
import { JoinInput, RsvpInput, VotesInput, parseBody } from './plan-input';
import { readOnlyAt } from './plan-rules';
import {
  type PlanRow,
  type Requester,
  findParticipantId,
  findPlanByShareToken,
  isPlanCreator,
  joinPlan,
  recordLinkOpened,
  setRsvp,
  setVotes,
} from './plan-store';
import { type PlanRoutesOptions, creatorLinks, keepCreatorCookie } from './plan-routes';
import { buildPlanView } from './plan-view';
import { isTokenShape, newToken, readCreatorToken, readGuestToken, setGuestToken } from './tokens';

const notFound = (): HttpError => new HttpError(404, 'not-found');

function shareTokenParam(req: Request): string {
  const token = req.params.token;
  if (typeof token !== 'string' || !isTokenShape(token)) throw notFound();
  return token;
}

export function guestRoutes({ config, db, now, box }: PlanRoutesOptions): Router {
  const router = express.Router();
  // Per (IP, plan), so many people behind one address can take part in one plan, under a per-IP ceiling.
  const guestCeiling = hourlyLimit(config.guestActionLimitPerHourPerIp);
  const joinLimit = hourlyLimit(config.joinLimitPerHour, ipAndLinkKey);
  const voteLimit = hourlyLimit(config.voteLimitPerHour, ipAndLinkKey);
  const rsvpLimit = hourlyLimit(config.rsvpLimitPerHour, ipAndLinkKey);
  // Opens are always served; past the hourly quota of an IP they are just not counted.
  const openCountQuota = hourlyQuota(config.linkOpenCountLimitPerHour);
  const firstOpenToday = dailyOpenDedupe();

  router.use('/api/k', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  /** The plan of the link (retention applied) and who is asking. */
  const resolve = async (req: Request, at: Date): Promise<{ token: string; plan: PlanRow; requester: Requester; isCreator: boolean }> => {
    const token = shareTokenParam(req);
    const plan = await findPlanByShareToken(db, token, at);
    if (!plan) throw notFound();
    const sub = await findAccountSub(req, config, db, at);
    const creatorToken = readCreatorToken(req, config, plan.id);
    const isCreator = isPlanCreator(plan, { sub, creatorToken });
    return { token, plan, isCreator, requester: { sub, creatorToken, guestToken: isCreator ? null : readGuestToken(req, config, plan.id) } };
  };

  /**
   * (Re)sets the guest cookie until the plan turns read-only (nothing left to do in it then), also after the
   * creator moves the deadline.
   */
  const keepGuestCookie = (res: Response, plan: PlanRow, guestToken: string, at: Date): void => {
    setGuestToken(res, config, plan.id, guestToken, readOnlyAt(plan.voteDeadline), at);
  };

  const answer = async (res: Response, plan: PlanRow, requester: Requester, isCreator: boolean, at: Date): Promise<void> => {
    const participantId = await findParticipantId(db, plan, requester);
    // The creator opening the page gets the links too (buildPlanView leaves them out for anyone else).
    if (isCreator) keepCreatorCookie(res, config, plan, requester, at);
    res.json({ plan: await buildPlanView(db, plan, { isCreator, participantId }, at, isCreator ? creatorLinks(box, config, plan) : null) });
  };

  router.get('/api/k/:token', openCountQuota, async (req, res) => {
    const at = now();
    const { plan, requester, isCreator } = await resolve(req, at);
    if (!isCreator) {
      if (requester.guestToken === null) {
        // Not joined: counted once per day per (IP, browser), held in memory only (daily-open-dedupe.ts).
        const ip = req.ip ?? '';
        if (!overHourlyQuota(res) && firstOpenToday(plan.id, ip, req.get('user-agent') ?? '', at)) await recordLinkOpened(db, plan.id, at);
      } else {
        keepGuestCookie(res, plan, requester.guestToken, at);
      }
    }
    await answer(res, plan, requester, isCreator, at);
  });

  // Each action answers with the plan as the transaction left it, not as it was read before.
  router.post('/api/k/:token/join', guestCeiling, joinLimit, async (req, res) => {
    const at = now();
    const { displayName } = parseBody(JoinInput, req.body);
    const { token, plan, requester, isCreator } = await resolve(req, at);
    if (!isCreator) {
      requester.guestToken ??= newToken();
      keepGuestCookie(res, plan, requester.guestToken, at);
    }
    const fresh = await joinPlan(db, token, requester, displayName, at);
    await answer(res, fresh, requester, isCreator, at);
  });

  router.post('/api/k/:token/votes', guestCeiling, voteLimit, async (req, res) => {
    const at = now();
    const { optionIds } = parseBody(VotesInput, req.body);
    const { token, requester, isCreator } = await resolve(req, at);
    const fresh = await setVotes(db, token, requester, optionIds, at);
    await answer(res, fresh, requester, isCreator, at);
  });

  router.post('/api/k/:token/rsvp', guestCeiling, rsvpLimit, async (req, res) => {
    const at = now();
    const { rsvp } = parseBody(RsvpInput, req.body);
    const { token, requester, isCreator } = await resolve(req, at);
    const fresh = await setRsvp(db, token, requester, rsvp, at);
    await answer(res, fresh, requester, isCreator, at);
  });

  return router;
}
