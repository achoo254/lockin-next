/*
 * Brand assets of the web app, derived from brand.config.json and the brand files through @achoo254/brand, so
 * a rebrand is "edit the brand, pnpm brand:gen, rebuild":
 *
 * - index.html: %APP_NAME% filled in, plus description, link-preview (og:) tags, manifest, Apple touch icon
 *   and favicon.ico next to the SVG favicon;
 * - the icons (brand/generated/icons/, made by pnpm brand:gen from the AI-drawn master icon) and the web manifest
 *   at the site root, served in dev and emitted in builds.
 *
 * Installing only adds a launcher entry that opens start_url "/" in scope "/", so the sign-in redirects stay
 * inside the installed app. There is no service worker.
 */
import { readFileSync } from 'node:fs';
import {
  type BrandConfigWith,
  FAVICON_ICO,
  type GenerateManifestsOptions,
  RASTER_ICONS,
  generateManifests,
  loadBrandConfig,
  svgManifestIcons,
  webIconFiles,
} from '@achoo254/brand/build';
import { primaryOrigin } from '@achoo254/brand/hosts';
import type { Plugin } from 'vite';

/** The repository root: brand.config.json and the icon paths inside it are relative to it. */
export const BRAND_ROOT = new URL('../../', import.meta.url);

/** Where pnpm brand:gen writes the manifest and icons. */
export const BRAND_GENERATED_DIR = new URL('brand/generated/', BRAND_ROOT);

const FAVICON_SVG = 'favicon.svg';
const BRAND_REQUIRE = ['colors.primary', 'colors.backgroundDark', 'webInstall'] as const;

export type LockinBrand = BrandConfigWith<(typeof BRAND_REQUIRE)[number]>;

export function loadLockinBrand(): LockinBrand {
  return loadBrandConfig(BRAND_ROOT, { require: BRAND_REQUIRE });
}

export const MANIFEST_OPTIONS: GenerateManifestsOptions = {
  web: {
    id: '/',
    lang: 'vi',
    dir: 'ltr',
    themeColor: 'background',
    categories: ['social', 'lifestyle'],
    preferRelatedApplications: false,
    icons: svgManifestIcons(FAVICON_SVG),
  },
  capacitor: false,
};

/** Link preview image (1200 × 630, apps/web/public/og-image.png, drawn by pnpm brand:gen). */
export const OG_IMAGE = { path: 'og-image.png', width: 1200, height: 630 };
export const MANIFEST_PATH = 'manifest.webmanifest';
const SVG_FAVICON_LINK = `<link rel="icon" type="image/svg+xml" href="/${FAVICON_SVG}" />`;

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);

const CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function contentType(path: string): string {
  return CONTENT_TYPES[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream';
}

/** URL path (no leading slash) → contents of everything served at the site root; read on use. */
export function brandFiles(brand: LockinBrand): ReadonlyMap<string, () => Buffer | string> {
  const manifest = `${JSON.stringify(generateManifests(brand, MANIFEST_OPTIONS)['web.webmanifest.json'])}\n`;
  const icons = webIconFiles(brand, { root: BRAND_ROOT, generatedDir: BRAND_GENERATED_DIR, faviconSvg: FAVICON_SVG });
  return new Map<string, () => Buffer | string>([
    ...icons.map((icon) => [icon.path, () => readFileSync(icon.file)] as const),
    [MANIFEST_PATH, () => manifest],
  ]);
}

/** index.html with the brand name filled in and the brand head tags added. */
export function renderIndexHtml(html: string, brand: LockinBrand): string {
  if (!html.includes(SVG_FAVICON_LINK)) throw new Error(`brand: index.html must contain ${SVG_FAVICON_LINK}`);
  const appleTouch = RASTER_ICONS.find((icon) => icon.file.startsWith('apple-touch-icon'));
  if (appleTouch === undefined) throw new Error('brand: no Apple touch icon in RASTER_ICONS');
  const origin = primaryOrigin(brand);
  const description = escapeHtml(brand.description);
  const tags = [
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${origin}/" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(brand.appName)}" />`,
    `<meta property="og:title" content="${escapeHtml(brand.appName)} · chốt kèo với bạn bè hay đồng nghiệp" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${origin}/" />`,
    `<meta property="og:locale" content="vi_VN" />`,
    `<meta property="og:image" content="${origin}/${OG_IMAGE.path}" />`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:image" content="${origin}/${OG_IMAGE.path}" />`,
    `<link rel="manifest" href="/${MANIFEST_PATH}" />`,
    `<link rel="apple-touch-icon" href="/${appleTouch.file}" sizes="${appleTouch.size}x${appleTouch.size}" />`,
    `<meta name="apple-mobile-web-app-title" content="${escapeHtml(brand.shortName)}" />`,
    `<link rel="icon" href="/${FAVICON_ICO}" sizes="16x16 32x32 48x48" />`,
  ];
  return html.replaceAll('%APP_NAME%', escapeHtml(brand.appName)).replace(SVG_FAVICON_LINK, [...tags, SVG_FAVICON_LINK].join('\n    '));
}

export function brandAssets(): Plugin {
  const brand = loadLockinBrand();
  const files = brandFiles(brand);
  return {
    name: 'lockin-brand-assets',
    transformIndexHtml: { order: 'pre', handler: (html) => renderIndexHtml(html, brand) },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]?.slice(1) ?? '';
        const read = files.get(path);
        if (read === undefined) {
          next();
          return;
        }
        try {
          res.setHeader('Content-Type', contentType(path));
          res.end(read());
        } catch (err) {
          next(err);
        }
      });
    },
    generateBundle() {
      for (const [fileName, read] of files) this.emitFile({ type: 'asset', fileName, source: read() });
    },
  };
}
