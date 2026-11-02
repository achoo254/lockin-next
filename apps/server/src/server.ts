import { createApp } from './app';
import { loadConfig } from './config';
import { purgeExpiredSessions } from './auth/session-store';
import { DEV_PGLITE_DIR, openPglite, openPostgres } from './db/client';
import { safeErrorText } from './log-error';

const config = loadConfig();
const pgliteDir = config.pgliteDir === null ? undefined : (config.pgliteDir ?? DEV_PGLITE_DIR);
const database = config.databaseUrl ? await openPostgres(config.databaseUrl) : await openPglite(pgliteDir);
console.log(`database: ${config.databaseUrl ? 'Postgres (DATABASE_URL)' : pgliteDir ? `PGlite at ${pgliteDir}` : 'PGlite in memory'}`);
console.log(`sign-in: ${config.auth ? `on (${config.auth.clientId} at ${config.auth.issuer})` : 'off (AUTH_CLIENT_SECRET unset)'}`);

/** Expired sessions are deleted at start and every hour (a session is otherwise only deleted when used again). */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
async function purgeSessions(): Promise<void> {
  try {
    const removed = await purgeExpiredSessions(database.db, new Date());
    if (removed > 0) console.log(`purged ${removed} expired session(s)`);
  } catch (error) {
    console.error('session purge failed', safeErrorText(error));
  }
}
await purgeSessions();
const purgeTimer = setInterval(() => void purgeSessions(), PURGE_INTERVAL_MS);
purgeTimer.unref();

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
  clearInterval(purgeTimer);
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
