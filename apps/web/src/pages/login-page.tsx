import { type ReactNode, useEffect } from 'react';
import { type SessionState, loginReturnPath, signInHref } from '../api/session-api';
import { useI18n } from '../i18n/i18n';
import { SignInCard } from '../layout/sign-in-card';

/**
 * /login: the sign-in card, for a link or bookmark that opens it. Only people making plans need an account; friends
 * vote through the link. The card's link is the server's route to the IdP, back to the page the visitor came from.
 */
export function LoginPage({ session }: { session: SessionState }): ReactNode {
  const { t, locale } = useI18n();
  const returnTo = loginReturnPath(window.location.search);
  const signedIn = session.status === 'ready' && session.signedIn;

  // Already signed in: nothing to do here.
  useEffect(() => {
    if (signedIn) window.location.replace(returnTo);
  }, [signedIn, returnTo]);

  return (
    <SignInCard href={signInHref(locale, returnTo)} title={t('signIn.title')} description={t('signIn.lead')} headingLevel={1}>
      {session.status === 'ready' && !session.signInAvailable && (
        <p className="alert alert-info" role="status" data-id="sign-in-unavailable">
          {t('login.unavailable')}
        </p>
      )}
    </SignInCard>
  );
}
