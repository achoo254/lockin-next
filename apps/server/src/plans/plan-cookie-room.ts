/**
 * Keeps a browser's per-plan cookies from piling up: every plan joined (`g`) or made (`c`) adds one, and a Cookie
 * header past the proxy's header buffers fails every request of the site. Before a cookie of a new plan is set to a
 * browser that already holds PLAN_COOKIE_ROOM of that kind, enough of them are expired to stay at that many: first
 * those of plans that are gone or read-only (nothing left to do with them), then the oldest.
 */
import type { Request, Response } from 'express';
import { inArray } from 'drizzle-orm';
import type { ServerConfig } from '../config';
import type { Db } from '../db/client';
import { plans } from '../db/schema';
import { readOnlyAt } from './plan-rules';
import { PLAN_COOKIE_ROOM } from './retention';
import { type PlanCookie, type PlanCookieKind, clearPlanCookie, listPlanCookies, setCreatorToken, setGuestToken } from './tokens';

/** The cookies to expire so that one more fits: none while there is room, stale ones first. */
export async function cookiesToDrop(db: Db, held: PlanCookie[], planId: string, now: Date): Promise<PlanCookie[]> {
  // Replacing a cookie the browser holds already adds nothing.
  if (held.length < PLAN_COOKIE_ROOM || held.some((cookie) => cookie.planId === planId)) return [];
  const excess = held.length - (PLAN_COOKIE_ROOM - 1);
  const rows = await db
    .select({ id: plans.id, voteDeadline: plans.voteDeadline })
    .from(plans)
    .where(
      inArray(
        plans.id,
        held.map((cookie) => cookie.planId),
      ),
    );
  const deadlines = new Map(rows.map((row) => [row.id, row.voteDeadline]));
  const isStale = (cookie: PlanCookie): boolean => {
    const deadline = deadlines.get(cookie.planId);
    return deadline === undefined || now.getTime() >= readOnlyAt(deadline).getTime();
  };
  // `held` is oldest first, and filter keeps that order within each group.
  return [...held.filter(isStale), ...held.filter((cookie) => !isStale(cookie))].slice(0, excess);
}

async function makeRoom(db: Db, req: Request, res: Response, config: ServerConfig, kind: PlanCookieKind, planId: string, now: Date): Promise<void> {
  for (const cookie of await cookiesToDrop(db, listPlanCookies(req, config, kind), planId, now)) clearPlanCookie(res, config, kind, cookie.planId);
}

/** Sets the guest cookie of the plan (tokens.ts setGuestToken), after making room for it. */
export async function putGuestCookie(db: Db, req: Request, res: Response, config: ServerConfig, cookie: PlanCookie, until: Date, now: Date): Promise<void> {
  await makeRoom(db, req, res, config, 'g', cookie.planId, now);
  setGuestToken(res, config, cookie.planId, cookie.token, until, now);
}

/** Sets the creator cookie of the plan (tokens.ts setCreatorToken), after making room for it. */
export async function putCreatorCookie(db: Db, req: Request, res: Response, config: ServerConfig, cookie: PlanCookie, until: Date, now: Date): Promise<void> {
  await makeRoom(db, req, res, config, 'c', cookie.planId, now);
  setCreatorToken(res, config, cookie.planId, cookie.token, until, now);
}
