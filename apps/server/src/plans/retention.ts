/**
 * How long a plan lives, counted from its vote deadline. The server enforces it (plan-rules.ts, the hourly sweep)
 * and the web app's privacy page prints the same numbers, so this file has no imports and is shared by both.
 */
export const READ_ONLY_AFTER_DAYS = 30;
export const DELETE_AFTER_DAYS = 90;
