import type { Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { HttpError } from '../http-error';
import { hashToken } from './tokens';

type KeyOf = (req: Request, res: Response) => string;

/** In-memory hourly counters (one server process, see the plan's RAM budget); `handler` runs once over the limit. */
function hourlyCounter(limit: number, key: KeyOf | undefined, handler: RequestHandler): RequestHandler {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(key ? { keyGenerator: key } : {}),
    handler,
  });
}

/** At most `limit` requests per hour, per client IP unless `key` says otherwise. Over it the API answers 429 `rate-limited`. */
export function hourlyLimit(limit: number, key?: KeyOf): RequestHandler {
  return hourlyCounter(limit, key, (_req, _res, next) => next(new HttpError(429, 'rate-limited')));
}

const OVER_QUOTA = 'lockinOverHourlyQuota';

/**
 * Counts requests per hour like hourlyLimit, but never refuses one: past `limit` the request goes on and
 * overHourlyQuota(res) is true, for work worth skipping then (not worth turning a reader away for).
 */
export function hourlyQuota(limit: number, key?: KeyOf): RequestHandler {
  return hourlyCounter(limit, key, (_req, res, next) => {
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
