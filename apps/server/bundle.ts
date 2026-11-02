// Production bundle: one ESM file with every dependency inlined, so the server needs only Node and the
// migrations (apps/server/drizzle), no workspace install and no tsx.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Two levels below apps/server like src/db, so the migrations folder resolves the same from the bundle.
  outfile: 'dist/server/index.mjs',
  // PGlite is dev/test only and loaded on demand; pg-native is an optional driver pg never needs here.
  external: ['@electric-sql/pglite', 'drizzle-orm/pglite', 'drizzle-orm/pglite/migrator', 'pg-native'],
  // Inlined CommonJS packages (express, pg) still call require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  sourcemap: true,
  logLevel: 'info',
});
