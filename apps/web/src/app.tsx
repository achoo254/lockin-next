import { type ReactNode, useEffect } from 'react';
import { LOGIN_PATH, useSession } from './api/session-api';
import { brand } from './brand';
import { useI18n } from './i18n/i18n';
import { LockinPage } from './layout/lockin-page';
import { ComingSoonPage } from './pages/coming-soon-page';
import { HomePage, NEW_PLAN_PATH } from './pages/home-page';
import type * as LegalPagesModule from './pages/legal-pages';
import type { LegalPageKind } from './pages/legal-pages';
import { LoginPage } from './pages/login-page';

export type LegalPages = typeof LegalPagesModule;

/** Page code outside the main bundle, loaded before the first render on its paths (main.tsx). */
export interface PageModules {
  /** The legal pages (mostly text); null when the path does not need them or they failed to load. */
  legalPages: LegalPages | null;
}

const NO_MODULES: PageModules = { legalPages: null };

const LEGAL_PATHS: Record<string, LegalPageKind> = { '/privacy': 'privacy', '/terms': 'terms', '/credits': 'credits' };

/** A shared plan link: /k/<token>. */
const PLAN_LINK = /^\/k\/[A-Za-z0-9_-]+$/;

/** Normalised path: no trailing slash except the root. */
export function routePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function isPlanLink(path: string): boolean {
  return PLAN_LINK.test(path);
}

/** The page modules the page at `pathname` needs. Rejects when one fails to load. */
export async function loadPageModules(pathname: string): Promise<PageModules> {
  const legalPages = LEGAL_PATHS[routePath(pathname)] ? await import('./pages/legal-pages') : null;
  return { legalPages };
}

function NotFound(): ReactNode {
  const { t } = useI18n();
  return (
    <article className="card doc" data-id="not-found">
      <h1 className="doc-title">{t('notFound.title')}</h1>
      <a className="btn btn-primary" href="/">
        {t('notFound.back')}
      </a>
    </article>
  );
}

/** A page whose code could not be loaded. */
function PageLoadFailed(): ReactNode {
  const { t } = useI18n();
  return (
    <p className="alert alert-error" role="alert" data-id="page-load-failed">
      {t('page.loadFailed')}{' '}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>
        {t('page.reload')}
      </button>
    </p>
  );
}

/** The page for the current path inside the shared frame. */
export function App({ pathname, modules = NO_MODULES }: { pathname: string; modules?: PageModules }): ReactNode {
  const { t, locale } = useI18n();
  const session = useSession();
  const path = routePath(pathname);
  const legal = LEGAL_PATHS[path];
  const { legalPages } = modules;
  const planLink = isPlanLink(path);

  useEffect(() => {
    let page: string;
    if (path === '/') page = t('intro.title');
    else if (path === LOGIN_PATH) page = t('signIn.title');
    else if (path === NEW_PLAN_PATH || planLink) page = t('soon.title');
    else if (legal && legalPages) page = legalPages.legalTitle(legal, locale);
    else if (legal) page = t('page.loadFailed');
    else page = t('notFound.title');
    document.title = `${page} · ${brand.appName}`;
  }, [path, legal, legalPages, planLink, locale, t]);

  let page: ReactNode;
  let layout: 'flow' | 'center' = 'flow';
  if (path === '/') page = <HomePage session={session} />;
  else if (path === LOGIN_PATH) {
    page = <LoginPage session={session} />;
    layout = 'center';
  } else if (path === NEW_PLAN_PATH || planLink) {
    page = <ComingSoonPage kind={planLink ? 'plan' : 'new'} />;
    layout = 'center';
  } else if (legal) page = legalPages ? <legalPages.LegalPage kind={legal} /> : <PageLoadFailed />;
  else page = <NotFound />;

  return (
    <LockinPage path={path} session={session} layout={layout}>
      {page}
    </LockinPage>
  );
}
