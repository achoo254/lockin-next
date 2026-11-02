import { AccountMenu } from '@achoo254/app-shell';
import { writePreference } from '@achoo254/app-shell/preferences';
import { type ReactNode, useState } from 'react';
import { LOGIN_PATH, type SessionState, type SessionUser, loginReturnPath, signOut, signUpHref } from '../api/session-api';
import { BRAND_MARK_SRC, ECOSYSTEM_URL, IDP_ACCOUNT_URL, brand } from '../brand';
import { LOCALES, type Locale, useI18n } from '../i18n/i18n';

/** Each language in its own words (never translated), and the short code the header pill shows. */
const LOCALE_NAMES: Record<Locale, string> = { vi: 'Tiếng Việt', en: 'English' };
const LOCALE_CODES: Record<Locale, string> = { vi: 'VI', en: 'EN' };

/**
 * The header's language pill. A pick is stored in the cookie every hoandat.com app reads (`hd_lang`), so the
 * other apps open in it too, then the page re-renders in it.
 */
function LanguageSwitch(): ReactNode {
  const { t, locale, setLocale } = useI18n();
  return (
    <fieldset className="lang-switch" data-id="lang-switch">
      <legend className="sr-only">{t('layout.language')}</legend>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          className="lang-option"
          lang={option}
          title={LOCALE_NAMES[option]}
          aria-pressed={option === locale}
          data-id={`lang-${option}`}
          onClick={() => {
            writePreference('lang', option, { domain: brand.primaryTenant.domain });
            setLocale(option);
          }}
        >
          <span aria-hidden="true">{LOCALE_CODES[option]}</span>
          <span className="sr-only">{LOCALE_NAMES[option]}</span>
        </button>
      ))}
    </fieldset>
  );
}

/** The signed-in account in place of the header's sign-up pill: the shared account menu (avatar, name, sign-out). */
function AccountButton({ user }: { user: SessionUser | undefined }): ReactNode {
  const { locale } = useI18n();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      // The session may already be gone; going home shows the real state either way.
      console.warn('sign-out failed', error instanceof Error ? error.message : typeof error);
    } finally {
      window.location.assign('/');
    }
  }

  return (
    <AccountMenu
      user={user ?? {}}
      locale={locale}
      domain={brand.primaryTenant.domain}
      idpAccountUrl={IDP_ACCOUNT_URL}
      signOut={{ onClick: () => void onSignOut(), busy: signingOut }}
    />
  );
}

/**
 * The sign-up pill, the account menu, or nothing when sign-in is not set up. The pill is a sign-up button: it goes
 * straight to making an account at the IdP and back to this page (from /login, to the page that sent the visitor).
 */
function AccountControl({ path, session }: { path: string; session: SessionState }): ReactNode {
  const { t, locale } = useI18n();
  if (session.status === 'ready' && session.signedIn) return <AccountButton user={session.user} />;
  // Sign-in is not configured on this server: no pill that would only come back with "not open yet".
  if (session.status === 'ready' && !session.signInAvailable) return null;
  const back = path === LOGIN_PATH ? loginReturnPath(window.location.search) : path;
  return (
    <a className="pill pill-primary" href={signUpHref(locale, back)} data-id="public-sign-in">
      {/* Signing in for the first time makes the account, so the pill invites a sign-up; short on phones. */}
      <span className="hide-phone">{t('layout.signIn')}</span>
      <span className="only-phone">{t('layout.signInShort')}</span>
    </a>
  );
}

function SiteHeader({ path, session }: { path: string; session: SessionState }): ReactNode {
  return (
    <header className="topbar" data-id="public-header">
      <div className="topbar-inner container">
        <a className="brand" href="/" data-id="public-home">
          <img className="brand-mark" src={BRAND_MARK_SRC} width={36} height={36} alt="" aria-hidden="true" />
          <span className="brand-name">{brand.appName}</span>
        </a>
        <div className="topbar-end">
          <LanguageSwitch />
          <AccountControl path={path} session={session} />
        </div>
      </div>
    </header>
  );
}

function SiteFooter({ path }: { path: string }): ReactNode {
  const { t } = useI18n();
  const domain = brand.primaryTenant.domain;
  const links = [
    { href: '/privacy', label: t('layout.privacy'), dataId: 'foot-privacy' },
    { href: '/terms', label: t('layout.terms'), dataId: 'foot-terms' },
    { href: '/credits', label: t('layout.credits'), dataId: 'foot-credits' },
  ];
  return (
    <footer className="foot" data-id="public-footer">
      <div className="foot-inner container">
        <div className="foot-brand">
          <img className="foot-mark" src={BRAND_MARK_SRC} width={28} height={28} alt="" aria-hidden="true" loading="lazy" decoding="async" />
          <a className="foot-home" href={ECOSYSTEM_URL} data-id="foot-home">
            {t('layout.ecosystem', { domain })}
          </a>
        </div>
        <nav className="foot-links" aria-label={t('layout.footLinks')}>
          {links.map((link) => (
            <a key={link.dataId} className="foot-link" href={link.href} data-id={link.dataId} aria-current={path === link.href ? 'page' : undefined}>
              {link.label}
            </a>
          ))}
        </nav>
        <p className="foot-note" data-id="foot-note">
          {t('layout.disclaimer')}
        </p>
      </div>
    </footer>
  );
}

interface LockinPageProps {
  /** Normalised path of the page (app.tsx routePath). */
  path: string;
  session: SessionState;
  /** "center" for a lone card (sign-in, coming soon). */
  layout?: 'flow' | 'center';
  children: ReactNode;
}

/** Every page, signed out or in: the app's header and footer around the page. */
export function LockinPage({ path, session, layout = 'flow', children }: LockinPageProps): ReactNode {
  const { t } = useI18n();
  return (
    <div className="site">
      <a className="skip-link" href="#main" data-id="skip-link">
        {t('layout.skip')}
      </a>
      <SiteHeader path={path} session={session} />
      {/* Focusable by the skip link only, not in the tab order. */}
      <main id="main" tabIndex={-1} className={layout === 'center' ? 'main container main-center' : 'main container'}>
        {layout === 'center' ? children : <div className="page">{children}</div>}
      </main>
      <SiteFooter path={path} />
    </div>
  );
}
