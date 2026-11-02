import type { ReactNode } from 'react';
import { BRAND_MARK_SRC, brand } from '../brand';
import { useI18n } from '../i18n/i18n';

interface SignInCardProps {
  /** The server's route to the IdP (session-api signInHref). */
  href: string;
  title: ReactNode;
  description: ReactNode;
  /** 1 on /login; 2 inside another page. */
  headingLevel: 1 | 2;
  /** After the note, e.g. "sign-in is not open yet". */
  children?: ReactNode;
}

/**
 * The one way to sign in: "Sign in with hoandat.com" to the account page, and how that page signs people in
 * (the app never sees the password). No "create account": the account page creates it.
 */
export function SignInCard({ href, title, description, headingLevel, children }: SignInCardProps): ReactNode {
  const { t } = useI18n();
  const domain = brand.primaryTenant.domain;
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section className="card sign-in-card" data-id="sign-in-card">
      <img className="sign-in-mark" src={BRAND_MARK_SRC} width={72} height={72} alt="" aria-hidden="true" decoding="async" />
      <Heading className="sign-in-title">{title}</Heading>
      <p className="sign-in-lead">{description}</p>
      <a className="btn btn-primary btn-cta" href={href} data-id="sign-in-cta">
        {t('signIn.cta', { domain })}
      </a>
      <p className="sign-in-note">{t('signIn.note', { domain })}</p>
      {children}
    </section>
  );
}
