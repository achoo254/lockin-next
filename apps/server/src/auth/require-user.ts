import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import type { ServerConfig } from '../config';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { HttpError } from '../http-error';
import { readSessionToken } from './session-cookie';
import { type SessionRow, findSession } from './session-store';

async function liveSession(req: Request, config: ServerConfig, db: Db, now: Date): Promise<SessionRow | null> {
  const token = readSessionToken(req, config);
  return token ? findSession(db, token, now) : null;
}

/** The signed-in account's id, or a 401 `sign-in-required` for a request without a live session. */
export async function requireUserId(req: Request, config: ServerConfig, db: Db, now: Date): Promise<string> {
  const session = await liveSession(req, config, db, now);
  if (!session) throw new HttpError(401, 'sign-in-required');
  return session.userId;
}

/** The IdP subject of the signed-in account, or null without a live session. */
export async function findAccountSub(req: Request, config: ServerConfig, db: Db, now: Date): Promise<string | null> {
  const session = await liveSession(req, config, db, now);
  if (!session) return null;
  const [user] = await db.select({ sub: users.sub }).from(users).where(eq(users.id, session.userId));
  return user?.sub ?? null;
}

/** The IdP subject of the signed-in account, or a 401 `sign-in-required`. */
export async function requireAccountSub(req: Request, config: ServerConfig, db: Db, now: Date): Promise<string> {
  const sub = await findAccountSub(req, config, db, now);
  if (!sub) throw new HttpError(401, 'sign-in-required');
  return sub;
}
