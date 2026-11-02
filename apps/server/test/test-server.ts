/** Serves the app on 127.0.0.1 with an in-memory PGlite for one test file. */
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { type Server, createServer } from 'node:http';
import { createApp } from '../src/app';
import type { TemplateLoader } from '../src/share/og-page';
import { type ServerConfig, loadConfig } from '../src/config';
import { type DbHandle, openPglite } from '../src/db/client';

export interface TestServer {
  origin: string;
  config: ServerConfig;
  database: DbHandle;
  close(): Promise<void>;
}

/**
 * `now`: the app's clock (defaults to the real one), for tests that move past deadlines. `loadTemplate`: the page
 * of /k/<token> (default: a bare page; the app's own loader would look for a web dev server).
 */
export async function startTestServer(
  env: Record<string, string> = {},
  overrides: Partial<ServerConfig> = {},
  now: () => Date = () => new Date(),
  loadTemplate: TemplateLoader = async () => '<!doctype html><html><head><title>test</title></head><body></body></html>',
): Promise<TestServer> {
  const database = await openPglite();
  // The app's public origin is the test server itself, known once it listens: listen first, then build the app.
  let handler: ReturnType<typeof createApp> | null = null;
  const server: Server = createServer((req, res) => {
    if (handler) handler(req, res);
    else res.writeHead(503).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // A key per server, as production has one (and no warning about a missing key in every test).
  const shareTokenKey = randomBytes(32).toString('base64');
  const config = { ...loadConfig({ NODE_ENV: 'test', PUBLIC_URL: origin, SHARE_TOKEN_KEY: shareTokenKey, ...env }), ...overrides };
  handler = createApp({ config, db: database.db, now, loadTemplate });
  return {
    origin,
    config,
    database,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await database.close();
    },
  };
}
