import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, openPglite } from '../db/client';
import { sessions } from '../db/schema';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, createSession, findProfile, findSession, purgeExpiredSessions, upsertUser } from './session-store';

describe('session purge', () => {
  let database: DbHandle;
  beforeAll(async () => {
    database = await openPglite();
  });
  afterAll(async () => {
    await database.close();
  });

  it('deletes sessions past their absolute or idle expiry and keeps live ones', async () => {
    const { db } = database;
    const t0 = new Date('2026-10-01T00:00:00Z');
    const userId = await upsertUser(db, 'account-purge', null, t0);
    const old = await createSession(db, userId, new Date(t0.getTime() - SESSION_ABSOLUTE_MS - 1000));
    const idle = await createSession(db, userId, new Date(t0.getTime() - SESSION_IDLE_MS - 1000));
    const live = await createSession(db, userId, t0);
    expect(await purgeExpiredSessions(db, t0)).toBe(2);
    expect(await db.select().from(sessions)).toHaveLength(1);
    expect(await findSession(db, live, t0)).not.toBeNull();
    expect(await findSession(db, old, t0)).toBeNull();
    expect(await findSession(db, idle, t0)).toBeNull();
    expect(await purgeExpiredSessions(db, t0)).toBe(0);
  });
});

describe('account profile', () => {
  let database: DbHandle;
  beforeAll(async () => {
    database = await openPglite();
  });
  afterAll(async () => {
    await database.close();
  });

  it('stores the profile of a sign-in, replaces it on the next, and keeps it when there is none', async () => {
    const { db } = database;
    const t0 = new Date('2026-10-29T00:00:00Z');
    const first = { name: 'A', email: 'a@example.com', picture: 'https://lh3.googleusercontent.com/a' };
    const id = await upsertUser(db, 'account-profile', first, t0);
    expect(await findProfile(db, id)).toEqual(first);
    expect(await upsertUser(db, 'account-profile', null, t0)).toBe(id);
    expect(await findProfile(db, id)).toEqual(first);
    const second = { name: 'B', email: null, picture: null };
    expect(await upsertUser(db, 'account-profile', second, t0)).toBe(id);
    expect(await findProfile(db, id)).toEqual(second);
    // An account that signed in before profiles were asked for has none yet.
    const old = await upsertUser(db, 'account-old', null, t0);
    expect(await findProfile(db, old)).toEqual({ name: null, email: null, picture: null });
  });
});
