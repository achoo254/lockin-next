import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['apps/server/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: [...configDefaults.exclude],
          // Server route tests migrate an in-memory PGlite per file; leave room for a loaded machine.
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
      'apps/web/vitest.config.ts',
    ],
  },
});
