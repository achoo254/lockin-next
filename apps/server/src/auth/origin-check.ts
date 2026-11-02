import type { RequestHandler } from 'express';
import { HttpError } from '../http-error';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence alongside SameSite=Lax: every state-changing request must carry the app's own `Origin`.
 * A missing Origin is rejected too; browsers always send it on cross-site POST and DELETE.
 */
export function requireSameOrigin(origin: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.headers.origin !== origin) throw new HttpError(403, 'forbidden-origin');
    next();
  };
}
