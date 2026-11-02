/**
 * GET /k/<token>: the web app's index.html with the link preview of the plan (og:title, og:description, og:url,
 * og:image, twitter:card), so a link pasted into Zalo or Messenger shows the plan's title. The web app then loads
 * the plan through /api/k/<token> as usual.
 *
 * Only the plan's title goes into the tags: never a voter's or the creator's name. og:url and the canonical link
 * repeat the very link that was opened (a crawler that finds another URL there would show that page's preview
 * instead); nothing else carries a token. A wrong, rotated or malformed token gets the same page with the app's
 * own tags and the same status, so the page tells nothing about which links exist.
 */
import { readFile } from 'node:fs/promises';
import express, { type Request, type Router } from 'express';
import brandConfig from '../../../../brand.config.json';
import type { ServerConfig } from '../config';
import type { Db } from '../db/client';
import { safeErrorText } from '../log-error';
import { findPlanByShareToken } from '../plans/plan-store';
import { isTokenShape } from '../plans/tokens';

/** The built web page (apps/web/dist/index.html); two levels below apps/server from src/share and from the bundle. */
export const BUILT_INDEX_HTML = new URL('../../../web/dist/index.html', import.meta.url);

/**
 * The CSP of the pages nginx serves (infra/nginx/lockin.hoandat.com.conf, `location /`), sent here too because the
 * plan page comes from this server. og-page.test.ts keeps the two identical.
 */
export const PAGE_CSP =
  "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com; font-src 'self'; connect-src 'self' https://cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'self'; manifest-src 'self'; frame-ancestors 'none'";

type PreviewLocale = 'vi' | 'en';

const PREVIEW_TEXT: Record<PreviewLocale, { title: (plan: string) => string; description: string }> = {
  vi: { title: (plan) => `${plan} · vote trên ${brandConfig.appName}`, description: `Vote giờ và chỗ trên ${brandConfig.appName} · không cần tài khoản` },
  en: { title: (plan) => `${plan} · vote on ${brandConfig.appName}`, description: `Vote on the time and place on ${brandConfig.appName} · no account needed` },
};

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export interface PlanPreview {
  title: string;
  description: string;
  /** The link that was opened. */
  url: string;
}

/** `<meta {attr}="{key}" content="…">` replaced in place, or added before </head>. Values are escaped here. */
function setMeta(html: string, attr: 'property' | 'name', key: string, content: string): string {
  const tag = `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`;
  const existing = new RegExp(`<meta\\s+${attr}="${key.replace(/[.:]/g, '\\$&')}"\\s+content="[^"]*"\\s*/?>`);
  return existing.test(html) ? html.replace(existing, () => tag) : html.replace('</head>', () => `  ${tag}\n  </head>`);
}

function setCanonical(html: string, url: string): string {
  const tag = `<link rel="canonical" href="${escapeHtml(url)}" />`;
  const existing = /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/;
  return existing.test(html) ? html.replace(existing, () => tag) : html.replace('</head>', () => `  ${tag}\n  </head>`);
}

/** The page with the plan's preview tags (null: the page's own tags, for a link that names no plan). */
export function renderPlanPage(template: string, preview: PlanPreview | null): string {
  let html = setMeta(template, 'name', 'robots', 'noindex');
  if (preview === null) return html;
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(preview.title)}</title>`);
  html = setMeta(html, 'name', 'description', preview.description);
  html = setMeta(html, 'property', 'og:title', preview.title);
  html = setMeta(html, 'property', 'og:description', preview.description);
  html = setMeta(html, 'property', 'og:url', preview.url);
  html = setMeta(html, 'name', 'twitter:card', 'summary_large_image');
  html = setMeta(html, 'name', 'twitter:title', preview.title);
  html = setMeta(html, 'name', 'twitter:description', preview.description);
  return setCanonical(html, preview.url);
}

/** Where the page template comes from. */
export type TemplateLoader = () => Promise<string>;

/**
 * Production: the built index.html, read once (a release restarts the server). Elsewhere: the web dev server at
 * PUBLIC_URL (Vite's page with its dev scripts), falling back to a local build.
 */
export function defaultTemplateLoader(config: ServerConfig): TemplateLoader {
  let built: string | null = null;
  const readBuilt = async (): Promise<string> => {
    built ??= await readFile(BUILT_INDEX_HTML, 'utf8');
    return built;
  };
  if (config.nodeEnv === 'production') return readBuilt;
  return async () => {
    try {
      const res = await fetch(`${config.publicOrigin}/`, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(5_000) });
      if (res.ok) return await res.text();
    } catch {
      // No web dev server running: try a local build.
    }
    return readBuilt();
  };
}

function previewLocale(req: Request): PreviewLocale {
  return req.query.lang === 'en' ? 'en' : 'vi';
}

export interface OgPageOptions {
  config: ServerConfig;
  db: Db;
  now: () => Date;
  loadTemplate: TemplateLoader;
}

export function ogPageRoutes({ config, db, now, loadTemplate }: OgPageOptions): Router {
  const router = express.Router();
  router.get('/k/:token', async (req, res) => {
    let template: string;
    try {
      template = await loadTemplate();
    } catch (error) {
      console.error('plan page template unavailable', safeErrorText(error));
      res.status(503).set('Cache-Control', 'no-store').type('text/plain').send('Temporarily unavailable');
      return;
    }
    const token = req.params.token;
    const plan = isTokenShape(token) ? await findPlanByShareToken(db, token, now()) : null;
    const text = PREVIEW_TEXT[previewLocale(req)];
    const preview = plan ? { title: text.title(plan.title), description: text.description, url: `${config.publicOrigin}/k/${token}` } : null;
    // Production gets the site's CSP; the dev page (Vite) runs inline scripts, so it gets none.
    if (config.nodeEnv === 'production') res.set('Content-Security-Policy', PAGE_CSP);
    else res.removeHeader('Content-Security-Policy');
    res
      .status(200)
      .set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' })
      .type('html')
      .send(renderPlanPage(template, preview));
  });
  return router;
}
