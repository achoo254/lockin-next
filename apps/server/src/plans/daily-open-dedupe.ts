/**
 * Counts a plan link open once per visitor per day without handing out a cookie or storing anything about the
 * visitor: a visitor is the hash of the client IP and the browser's User-Agent, salted with a random value made
 * fresh every UTC day, and kept in this process's memory only. At the turn of the day (or a restart) the set and
 * the salt are dropped, so nothing links one day's visitors to the next. Several people behind one address with
 * the same browser count as one; past MAX_SEEN visitors in a day the set starts over (some opens count twice).
 */
import { createHash, randomBytes } from 'node:crypto';

const MAX_SEEN = 50_000;

/** True the first time this (plan, IP, User-Agent) opens the link today (UTC), false for every repeat. */
export type FirstOpenToday = (planId: string, ip: string, userAgent: string, at: Date) => boolean;

export function dailyOpenDedupe(): FirstOpenToday {
  let day = '';
  let salt = Buffer.alloc(0);
  let seen = new Set<string>();
  return (planId, ip, userAgent, at) => {
    const today = at.toISOString().slice(0, 10);
    if (today !== day || seen.size >= MAX_SEEN) {
      day = today;
      salt = randomBytes(16);
      seen = new Set();
    }
    const key = createHash('sha256').update(salt).update(`${planId}\n${ip}\n${userAgent}`).digest('base64url');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}
