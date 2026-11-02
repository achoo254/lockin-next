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

  it('sends no Referer from any page (the plan page address carries the share link)', () => {
    expect(readFileSync(file('./index.html'), 'utf8')).toContain('<meta name="referrer" content="no-referrer" />');
    const policies = readFileSync(file('../../infra/nginx/lockin.hoandat.com.conf'), 'utf8').match(/add_header Referrer-Policy "[^"]*"/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) expect(policy).toBe('add_header Referrer-Policy "no-referrer"');
  });
});

describe('nginx logs', () => {
  const conf = (): string => readFileSync(file('../../infra/nginx/lockin.hoandat.com.conf'), 'utf8');

  it('logs access without the Referer or query strings, in every access_log of the site', () => {
    const format = /log_format lockin_notoken ([^;]*);/.exec(conf())?.[1] ?? '';
    // The combined layout, with the Referer field blanked and the request line built from $uri.
    expect(format).toBe(`'$remote_addr - $remote_user [$time_local] "$request_method $uri $server_protocol" $status $body_bytes_sent "-" "$http_user_agent"'`);
    expect(conf()).toContain('access_log /var/log/nginx/lockin.hoandat.com.access.log lockin_notoken;');
    for (const leak of ['$http_referer', '$request ', '$request"', '$request_uri', '$args', '$query_string']) expect(format).not.toContain(leak);
    const accessLogs = conf().match(/access_log [^;]*;/g) ?? [];
    expect(accessLogs.length).toBeGreaterThan(0);
    for (const line of accessLogs) expect(line).toMatch(/^access_log (off|\S+ lockin_notoken);$/);
  });

  it('keeps plan links and manage links out of the access log and the error log', () => {
    const match = /location ~ (\S+) \{([^}]*)\}/.exec(conf());
    const pattern = new RegExp(match?.[1] ?? '$^');
    for (const path of ['/k/abc', '/api/k/abc/join', '/m/0b6f2a52-9a7e-4c51-8a35-2d7d1f0c9a11.abc']) expect(pattern.test(path)).toBe(true);
    for (const path of ['/api/plans', '/auth/login', '/my']) expect(pattern.test(path)).toBe(false);
    const block = match?.[2] ?? '';
    expect(block).toContain('access_log off;');
    expect(block).toMatch(/error_log \S+ crit;/);
  });
});
