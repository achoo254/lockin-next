import { defineConfig } from 'drizzle-kit';

// Migrations are generated SQL, committed and reviewed like code. Never `drizzle-kit push` to a real database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
