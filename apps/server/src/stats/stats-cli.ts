/**
 * `pnpm stats [--exclude-owner]`: prints the funnel numbers of the database at DATABASE_URL, read-only.
 * `--exclude-owner` leaves out plans made by the accounts in STATS_EXCLUDE_SUBS (the owner's own plans), to see
 * what people outside use.
 */
import { openPostgresReadOnly } from '../db/client';
import { safeErrorText } from '../log-error';
import { computeStats, formatStats, parseSubs } from './plan-stats';

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (the stats read the production database, read-only)');
    return 1;
  }
  const excludeOwner = process.argv.includes('--exclude-owner');
  const excludeSubs = excludeOwner ? parseSubs(process.env.STATS_EXCLUDE_SUBS) : [];
  if (excludeOwner && excludeSubs.length === 0) {
    console.error('--exclude-owner needs STATS_EXCLUDE_SUBS (account subs, comma-separated)');
    return 1;
  }
  const database = openPostgresReadOnly(url);
  try {
    const stats = await computeStats(database.db, { excludeSubs });
    console.log(formatStats(stats, excludeOwner ? `without ${excludeSubs.length} excluded account(s)` : 'all accounts'));
    return 0;
  } catch (error) {
    console.error('stats failed', safeErrorText(error));
    return 1;
  } finally {
    await database.close();
  }
}

process.exitCode = await main();
