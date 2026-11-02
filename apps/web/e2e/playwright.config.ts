import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { API_PORT, E2E_CLIENT_SECRET, FAKE_IDP_PORT, WEB_PORT } from './e2e-env';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.resolve(WEB_DIR, '../server');

/**
 * Real web app (Vite) and real API (PGlite in memory) against a test-only IdP. Ports are fixed and the servers are
 * never reused, so a stale dev server fails the run instead of being tested by mistake.
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure', locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm exec tsx e2e/fake-idp-server.ts',
      cwd: WEB_DIR,
      url: `http://127.0.0.1:${FAKE_IDP_PORT}/.well-known/openid-configuration`,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm exec tsx src/server.ts',
      cwd: SERVER_DIR,
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        PUBLIC_URL: `http://localhost:${WEB_PORT}`,
        PGLITE_DIR: 'memory',
        AUTH_ISSUER: `http://127.0.0.1:${FAKE_IDP_PORT}`,
        AUTH_CLIENT_SECRET: E2E_CLIENT_SECRET,
      },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      cwd: WEB_DIR,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
