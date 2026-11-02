import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * An account of the hoandat.com IdP that signed in here: its `sub`, and the name, email and picture its userinfo
 * gave at the latest sign-in (scope `openid profile email`), shown in the header's account menu. The three are
 * null for an account whose userinfo gave none.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  sub: text('sub').notNull().unique(),
  name: text('name'),
  email: text('email'),
  picture: text('picture'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** Web sessions. `id` is the sha256 of the opaque cookie token, never the token itself. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);
