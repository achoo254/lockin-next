import type { Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { HttpError } from '../http-error';

/**
 * At most `limit` requests per hour, per client IP unless `key` says otherwise. Over it the API answers 429
 * `rate-limited`. In-memory counters: one server process (see the plan's RAM budget).
 */
export function hourlyLimit(limit: number, key?: (req: Request, res: Response) => string): RequestHandler {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(key ? { keyGenerator: key } : {}),
    handler: (_req, _res, next) => next(new HttpError(429, 'rate-limited')),
  });
}
