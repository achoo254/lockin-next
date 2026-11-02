import type { ReactNode } from 'react';
import type { SessionState } from '../api/session-api';
import { useI18n } from '../i18n/i18n';
import { LoadingCard } from '../plans/plan-parts';
import { PlanForm } from '../plans/plan-form';

export const NEW_PLAN_PATH = '/new';

/**
 * /new: the create form, for anyone. Signed in, the account's name is pre-filled and the plan is the account's;
 * signed out, the creator's name is required and the plan lives in this browser (and its manage link) until it is
 * saved to an account.
 */
export function NewPlanPage({ session }: { session: SessionState }): ReactNode {
  const { t } = useI18n();
  if (session.status === 'loading') return <LoadingCard />;
  return (
    <div className="column">
      <header className="page-head">
        <h1 className="hero-title">
          {t('new.titleStart')} <em>{t('new.titleEm')}</em>
        </h1>
        <p className="muted">{t('new.lead')}</p>
      </header>
      <PlanForm
        defaultName={session.signedIn ? (session.user?.name ?? '') : ''}
        nameRequired={!session.signedIn}
        onCreated={(id) => window.location.assign(`/plans/${encodeURIComponent(id)}`)}
      />
    </div>
  );
}
