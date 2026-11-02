/**
 * The plan page's API, for anyone holding the share link: read the plan, join with a display name (or rename),
 * vote, and say whether one goes. No account needed: a guest is the random token in an HttpOnly cookie for this
 * plan, handed out on the first open. The creator, when signed in, is recognised by account instead.
 *
 * A wrong, rotated or malformed token is the same 404 `not-found` as a deleted plan.
 */
import express, { type Request, type Response, type Router } from 'express';
import { findAccountSub } from '../auth/require-user';
import { HttpError } from '../http-error';
import { hourlyLimit } from './hourly-limit';
import { JoinInput, RsvpInput, VotesInput, parseBody } from './plan-input';
import { deleteAt } from './plan-rules';
import { type PlanRow, type Requester, findParticipantId, findPlanByShareToken, joinPlan, recordLinkOpened, setRsvp, setVotes } from './plan-store';
import type { PlanRoutesOptions } from './plan-routes';
import { buildPlanView } from './plan-view';
import { isTokenShape, newToken, readGuestToken, setGuestToken } from './tokens';

const notFound = (): HttpError => new HttpError(404, 'not-found');

function shareTokenParam(req: Request): string {
  const token = req.params.token;
  if (typeof token !== 'string' || !isTokenShape(token)) throw notFound();
  return token;
}

export function guestRoutes({ config, db, now }: PlanRoutesOptions): Router {
  const router = express.Router();
  const joinLimit = hourlyLimit(config.joinLimitPerHour);
  const voteLimit = hourlyLimit(config.voteLimitPerHour);

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
    const isCreator = sub !== null && sub === plan.creatorSub;
    return { token, plan, isCreator, requester: { sub, guestToken: isCreator ? null : readGuestToken(req, config, plan.id) } };
  };

  /** (Re)sets the guest cookie so it lives as long as the plan, even after the creator moves the deadline. */
  const keepGuestCookie = (res: Response, plan: PlanRow, guestToken: string, at: Date): void => {
    setGuestToken(res, config, plan.id, guestToken, deleteAt(plan.voteDeadline), at);
  };

  const answer = async (res: Response, plan: PlanRow, requester: Requester, isCreator: boolean, at: Date): Promise<void> => {
    const participantId = await findParticipantId(db, plan, requester);
    res.json({ plan: await buildPlanView(db, plan, { isCreator, participantId }, at) });
  };

  router.get('/api/k/:token', async (req, res) => {
    const at = now();
    const { plan, requester, isCreator } = await resolve(req, at);
    if (!isCreator) {
      // First open from this browser: hand out its guest token now and count the open once (a browser that
      // refuses cookies is counted on every open).
      if (requester.guestToken === null) {
        requester.guestToken = newToken();
        await recordLinkOpened(db, plan.id, at);
      }
      keepGuestCookie(res, plan, requester.guestToken, at);
    }
    await answer(res, plan, requester, isCreator, at);
  });

  router.post('/api/k/:token/join', joinLimit, async (req, res) => {
    const at = now();
    const { displayName } = parseBody(JoinInput, req.body);
    const { token, plan, requester, isCreator } = await resolve(req, at);
    if (!isCreator) {
      requester.guestToken ??= newToken();
      keepGuestCookie(res, plan, requester.guestToken, at);
    }
    await joinPlan(db, token, requester, displayName, at);
    await answer(res, plan, requester, isCreator, at);
  });

  router.post('/api/k/:token/votes', voteLimit, async (req, res) => {
    const at = now();
    const { optionIds } = parseBody(VotesInput, req.body);
    const { token, plan, requester, isCreator } = await resolve(req, at);
    await setVotes(db, token, requester, optionIds, at);
    await answer(res, plan, requester, isCreator, at);
  });

  router.post('/api/k/:token/rsvp', voteLimit, async (req, res) => {
    const at = now();
    const { rsvp } = parseBody(RsvpInput, req.body);
    const { token, plan, requester, isCreator } = await resolve(req, at);
    await setRsvp(db, token, requester, rsvp, at);
    await answer(res, plan, requester, isCreator, at);
  });

  return router;
}
