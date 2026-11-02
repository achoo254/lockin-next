import type { ReactNode } from 'react';
import { type SessionState, signInHref } from '../api/session-api';
import { useI18n } from '../i18n/i18n';
import { SignInCard } from '../layout/sign-in-card';
import { LoadingCard } from '../plans/plan-parts';
import { PlanForm } from '../plans/plan-form';

export const NEW_PLAN_PATH = '/new';

/** /new: the create form for a signed-in account; the sign-in card (back here) otherwise. */
export function NewPlanPage({ session }: { session: SessionState }): ReactNode {
  const { t, locale } = useI18n();
  if (session.status === 'loading') return <LoadingCard />;
  if (!session.signedIn) {
    return <SignInCard href={signInHref(locale, NEW_PLAN_PATH)} title={t('signIn.title')} description={t('signIn.lead')} headingLevel={1} />;
  }
  return (
    <div className="column">
      <h1 className="sr-only">{t('layout.newPlan')}</h1>
      <PlanForm defaultName={session.user?.name ?? ''} onCreated={(id) => window.location.assign(`/plans/${encodeURIComponent(id)}`)} />
    </div>
  );
}
