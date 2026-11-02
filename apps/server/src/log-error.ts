/**
 * Error text that is safe for the journal. A failed query's message (drizzle's DrizzleQueryError) carries the
 * SQL and its bound parameters, i.e. what people typed (plan titles, guest names), so for those only the database error's
 * class, code and message are kept (Postgres error messages do not echo bound values). Other errors keep
 * their name and message; no stack (it starts with the message).
 */
import { DrizzleQueryError } from 'drizzle-orm/errors';

function field(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const found: unknown = (value as Record<string, unknown>)[key];
  return typeof found === 'string' ? found : undefined;
}

export function safeErrorText(error: unknown): string {
  if (error instanceof DrizzleQueryError) {
    const cause = error.cause;
    const parts = [field(cause, 'name') ?? 'database error', field(cause, 'code'), field(cause, 'message')].filter(Boolean);
    return `query failed: ${parts.join(' ')}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error;
}
