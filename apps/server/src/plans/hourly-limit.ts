import type { Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { HttpError } from '../http-error';
import { hashToken } from './tokens';

type KeyOf = (req: Request, res: Response) => string;
/** True for a request this counter leaves alone (another counter is in charge of it). */
type SkipIf = (req: Request, res: Response) => boolean;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** In-memory counters over a window (one server process, see the plan's RAM budget); `handler` runs once over the limit. */
function windowCounter(limit: number, windowMs: number, key: KeyOf | undefined, skip: SkipIf | undefined, handler: RequestHandler): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(key ? { keyGenerator: key } : {}),
    ...(skip ? { skip } : {}),
    handler,
  });
}

const refuse: RequestHandler = (_req, _res, next) => next(new HttpError(429, 'rate-limited'));

/**
 * At most `limit` requests per hour, per client IP unless `key` says otherwise; requests `skip` picks are not
 * counted. Over it the API answers 429 `rate-limited`.
 */
export function hourlyLimit(limit: number, key?: KeyOf, skip?: SkipIf): RequestHandler {
  return windowCounter(limit, HOUR_MS, key, skip, refuse);
}

/** Like hourlyLimit, over a day: a ceiling above the hourly one. */
export function dailyLimit(limit: number, key?: KeyOf, skip?: SkipIf): RequestHandler {
  return windowCounter(limit, DAY_MS, key, skip, refuse);
}

const OVER_QUOTA = 'lockinOverHourlyQuota';

/**
 * Counts requests per hour like hourlyLimit, but never refuses one: past `limit` the request goes on and
 * overHourlyQuota(res) is true, for work worth skipping then (not worth turning a reader away for).
 */
export function hourlyQuota(limit: number, key?: KeyOf): RequestHandler {
  return windowCounter(limit, HOUR_MS, key, undefined, (_req, res, next) => {
    res.locals[OVER_QUOTA] = true;
    next();
  });
}

export function overHourlyQuota(res: Response): boolean {
  return res.locals[OVER_QUOTA] === true;
}

/**
 * The client IP (IPv6 by its /56, as express-rate-limit does) and the plan link of a /api/k/:token route, hashed:
 * many people behind one address (office Wi-Fi, carrier NAT) each get their own count per plan.
 */
export function ipAndLinkKey(req: Request): string {
  const token = typeof req.params.token === 'string' ? req.params.token : '';
  return `${ipKeyGenerator(req.ip ?? '')}|${hashToken(token)}`;
}
