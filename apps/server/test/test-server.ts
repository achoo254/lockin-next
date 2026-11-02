/** Serves the app on 127.0.0.1 with an in-memory PGlite for one test file. */
import type { AddressInfo } from 'node:net';
import { type Server, createServer } from 'node:http';
import { createApp } from '../src/app';
import { type ServerConfig, loadConfig } from '../src/config';
import { type DbHandle, openPglite } from '../src/db/client';

export interface TestServer {
  origin: string;
  config: ServerConfig;
  database: DbHandle;
  close(): Promise<void>;
}

export async function startTestServer(env: Record<string, string> = {}, overrides: Partial<ServerConfig> = {}): Promise<TestServer> {
  const database = await openPglite();
  // The app's public origin is the test server itself, known once it listens: listen first, then build the app.
  let handler: ReturnType<typeof createApp> | null = null;
  const server: Server = createServer((req, res) => {
    if (handler) handler(req, res);
    else res.writeHead(503).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const config = { ...loadConfig({ NODE_ENV: 'test', PUBLIC_URL: origin, ...env }), ...overrides };
  handler = createApp({ config, db: database.db });
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
