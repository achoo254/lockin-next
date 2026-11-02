/**
 * How long a plan lives, counted from its vote deadline, and how many per-plan cookies a browser keeps. The server
 * enforces them (plan-rules.ts, the hourly sweep, plan-cookie-room.ts) and the web app's privacy page prints the same
 * numbers, so this file has no imports and is shared by both.
 */
export const READ_ONLY_AFTER_DAYS = 30;
export const DELETE_AFTER_DAYS = 90;
/** Most per-plan cookies of one kind (guest, creator) a browser keeps, the newest one included. */
export const PLAN_COOKIE_ROOM = 40;
