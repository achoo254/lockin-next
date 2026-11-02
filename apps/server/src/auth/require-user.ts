import type { Request } from 'express';
import type { ServerConfig } from '../config';
import type { Db } from '../db/client';
import { HttpError } from '../http-error';
import { readSessionToken } from './session-cookie';
import { findSession } from './session-store';

/** The signed-in account's id, or a 401 `sign-in-required` for a request without a live session. */
export async function requireUserId(req: Request, config: ServerConfig, db: Db, now: Date): Promise<string> {
  const token = readSessionToken(req, config);
  const session = token ? await findSession(db, token, now) : null;
  if (!session) throw new HttpError(401, 'sign-in-required');
  return session.userId;
}
