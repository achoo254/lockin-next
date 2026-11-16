/*
 * Each public page besides the home page gets its own copy of index.html at build time (dist/<path>/index.html),
 * with the canonical link and og:url pointing at that page. Without it nginx answers /credits, /privacy and
 * /terms with the SPA fallback, whose canonical is the home page, and Google treats them as duplicates of "/"
 * and leaves them out of the index. nginx tries `$uri/index.html` before the fallback
 * (infra/nginx/lockin.hoandat.com.conf); every other address still gets index.html.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { primaryOrigin } from '@achoo254/brand/hosts';
import type { Plugin } from 'vite';
import { loadLockinBrand } from './vite-brand.ts';

/** Public pages other than "/", each listed in public/sitemap.xml (checked by vite-static-pages.test.ts). */
export const STATIC_PAGES = ['/credits', '/privacy', '/terms'] as const;

/** Replaces the single match of `pattern`; the template is ours, so anything else is a bug worth failing on. */
function replaceOnce(html: string, pattern: RegExp, replacement: string): string {
  const count = html.match(new RegExp(pattern.source, 'g'))?.length ?? 0;
  if (count !== 1) throw new Error(`static pages: expected one ${pattern.source} in index.html, found ${count}`);
  return html.replace(pattern, () => replacement);
}

/** index.html with the canonical link and og:url of `pagePath` instead of the home page. */
export function staticPageHtml(indexHtml: string, origin: string, pagePath: string): string {
  const url = `${origin}${pagePath}`;
  const withCanonical = replaceOnce(indexHtml, /<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`);
  return replaceOnce(withCanonical, /<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`);
}

export function staticPages(): Plugin {
  return {
    name: 'lockin-static-pages',
    apply: 'build',
    writeBundle(options) {
      const outDir = options.dir ?? 'dist';
      const indexHtml = readFileSync(path.join(outDir, 'index.html'), 'utf8');
      const origin = primaryOrigin(loadLockinBrand());
      for (const pagePath of STATIC_PAGES) {
        const dir = path.join(outDir, pagePath.slice(1));
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'index.html'), staticPageHtml(indexHtml, origin, pagePath));
      }
    },
  };
}
