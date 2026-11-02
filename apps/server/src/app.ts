import express, { type ErrorRequestHandler, type Express } from 'express';
import helmet from 'helmet';
import { sql } from 'drizzle-orm';
import { authRoutes } from './auth/auth-routes';
import { requireSameOrigin } from './auth/origin-check';
import type { ServerConfig } from './config';
import type { Db } from './db/client';
import { HttpError } from './http-error';
import { safeErrorText } from './log-error';
import { guestRoutes } from './plans/guest-routes';
import { planRoutes, shareTokenBoxOf } from './plans/plan-routes';
import { type TemplateLoader, defaultTemplateLoader, ogPageRoutes } from './share/og-page';

export interface AppDeps {
  config: ServerConfig;
  db: Db;
  now?: () => Date;
  /** The page template of /k/<token> (tests pass one; default: share/og-page.ts defaultTemplateLoader). */
  loadTemplate?: TemplateLoader;
}

/**
 * The API: health check, sign-in, the creator's plan routes and the plan page's (guest) routes, plus the plan link
 * page /k/<token> (index.html with the plan's link preview). The rest of the web app is static (nginx in production).
 */
export function createApp({ config, db, now = () => new Date(), loadTemplate = defaultTemplateLoader(config) }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // nginx on the same host sets X-Forwarded-For; trust it from loopback only (rate limits use the client IP).
  app.set('trust proxy', 'loopback');
  app.use(helmet());

  app.get('/healthz', async (_req, res) => {
    await db.execute(sql`select 1`);
    res.set('Cache-Control', 'no-store').type('text/plain').send('ok');
  });

  app.use(ogPageRoutes({ config, db, now, loadTemplate }));

  app.use(requireSameOrigin(config.publicOrigin));
  // 32 KB: a plan with ten long Google Maps links (desktop links run to a couple of KB each) fits; nginx allows 48k.
  app.use(express.json({ limit: '32kb' }));
  app.use(authRoutes({ config, db, now }));
  const box = shareTokenBoxOf(config);
  app.use(planRoutes({ config, db, now, box }));
  app.use(guestRoutes({ config, db, now, box }));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not-found')));

  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code });
      return;
    }
    // Malformed JSON and oversized bodies from express.json().
    if (typeof err === 'object' && err !== null && 'type' in err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
      res.status(400).json({ error: 'invalid-body' });
      return;
    }
    // Never the raw error: a failed query's message carries its bound values (names people typed).
    console.error('request failed', safeErrorText(err));
    res.status(500).json({ error: 'internal' });
  };
  app.use(onError);
  return app;
}
