import { createApp } from './app';
import { loadConfig } from './config';
import { purgeExpiredSessions } from './auth/session-store';
import { DEV_PGLITE_DIR, openPglite, openPostgres } from './db/client';
import { safeErrorText } from './log-error';
import { sweepPlans } from './plans/plan-store';

const config = loadConfig();
const pgliteDir = config.pgliteDir === null ? undefined : (config.pgliteDir ?? DEV_PGLITE_DIR);
const database = config.databaseUrl ? await openPostgres(config.databaseUrl) : await openPglite(pgliteDir);
console.log(`database: ${config.databaseUrl ? 'Postgres (DATABASE_URL)' : pgliteDir ? `PGlite at ${pgliteDir}` : 'PGlite in memory'}`);
console.log(`sign-in: ${config.auth ? `on (${config.auth.clientId} at ${config.auth.issuer})` : 'off (AUTH_CLIENT_SECRET unset)'}`);

/**
 * Housekeeping at start and every hour: expired sessions are deleted (a session is otherwise only deleted when used
 * again), and plan retention runs (plans turn read-only, then are deleted; reads apply it lazily in between).
 */
const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;
async function housekeeping(): Promise<void> {
  const now = new Date();
  try {
    const removed = await purgeExpiredSessions(database.db, now);
    if (removed > 0) console.log(`purged ${removed} expired session(s)`);
  } catch (error) {
    console.error('session purge failed', safeErrorText(error));
  }
  try {
    const { expired, deleted } = await sweepPlans(database.db, now);
    if (expired + deleted > 0) console.log(`plan retention: ${expired} turned read-only, ${deleted} deleted`);
  } catch (error) {
    console.error('plan retention failed', safeErrorText(error));
  }
}
await housekeeping();
// unref: the timer never keeps the process alive on its own (shutdown clears it too).
const housekeepingTimer = setInterval(() => void housekeeping(), HOUSEKEEPING_INTERVAL_MS);
housekeepingTimer.unref();

// Loopback only: nginx (production) and the web dev server proxy to it.
const server = createApp({ config, db: database.db }).listen(config.port, '127.0.0.1', () => {
  console.log(`lockin server listening on 127.0.0.1:${config.port} (${config.nodeEnv})`);
});
// A taken port must stop the process (systemd restarts it), not leave it running without a listener.
server.on('error', (error) => {
  console.error('listen failed', safeErrorText(error));
  process.exit(1);
});

let stopping = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) process.exit(1);
  stopping = true;
  console.log(`${signal}: closing`);
  clearInterval(housekeepingTimer);
  server.close();
  try {
    await database.close();
    process.exit(0);
  } catch (error) {
    console.error('shutdown failed', safeErrorText(error));
    process.exit(1);
  }
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => void shutdown(signal));
