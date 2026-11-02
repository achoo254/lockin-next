// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The pages have no inline script (one designed theme, nothing to set before the first paint), so the CSP of the
 * nginx site allows scripts from the site and Cloudflare Web Analytics only, with no hash to keep in step.
 */
const file = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url).href);

describe('index.html and the CSP', () => {
  it('has no inline script, only the module entry', () => {
    const html = readFileSync(file('./index.html'), 'utf8');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
  });

  it('allows images from the site and the account pictures of Google and GitHub sign-ins only', () => {
    const imgSrcs = readFileSync(file('../../infra/nginx/lockin.hoandat.com.conf'), 'utf8').match(/img-src [^;"]*/g) ?? [];
    expect(imgSrcs.length).toBeGreaterThan(0);
    for (const imgSrc of imgSrcs) expect(imgSrc.trim()).toBe("img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com");
  });

  it('allows scripts from the site and Cloudflare Web Analytics only', () => {
    const scriptSrcs = readFileSync(file('../../infra/nginx/lockin.hoandat.com.conf'), 'utf8').match(/script-src [^;"]*/g) ?? [];
    expect(scriptSrcs.length).toBeGreaterThan(0);
    for (const scriptSrc of scriptSrcs) expect(scriptSrc.trim()).toBe("script-src 'self' https://static.cloudflareinsights.com");
  });
});
