import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { type PlanSummary, listPlans, sharePath } from '../api/plans-api';
import { type SessionState, signInHref } from '../api/session-api';
import { useI18n } from '../i18n/i18n';
import { SignInCard } from '../layout/sign-in-card';
import { errorMessage } from '../plans/error-message';
import { LoadingCard, StateCard } from '../plans/plan-parts';
import { formatVnDateTime } from '../plans/vn-time';
import { Icon } from '../ui/icon';
import { NEW_PLAN_PATH } from './new-plan-page';

export const MY_PLANS_PATH = '/plans';

/** /plans: the creator's plans, newest first. */
export function MyPlansPage({ session }: { session: SessionState }): ReactNode {
  const { t, locale } = useI18n();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const signedIn = session.status === 'ready' && session.signedIn;

  /** Loads once more, after a failure or a new link. */
  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setPlans(await listPlans());
    } catch (failure) {
      setError(failure);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    listPlans().then(
      (value) => live && setPlans(value),
      (failure: unknown) => live && setError(failure),
    );
    return () => {
      live = false;
    };
  }, [signedIn]);

  if (session.status === 'loading') return <LoadingCard />;
  if (!signedIn) return <SignInCard href={signInHref(locale, MY_PLANS_PATH)} title={t('signIn.title')} description={t('signIn.lead')} headingLevel={1} />;

  let body: ReactNode;
  if (error)
    body = (
      <StateCard icon="refresh" title={t('state.errorTitle')} text={errorMessage(error, t)} tone="error" dataId="state-error">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()}>
          {t('state.retry')}
        </button>
      </StateCard>
    );
  else if (!plans) body = <LoadingCard />;
  else if (plans.length === 0)
    body = (
      <StateCard icon="inbox" title={t('state.emptyTitle')} text={t('state.emptyText')} dataId="state-empty">
        <a className="btn btn-primary btn-sm" href={NEW_PLAN_PATH} data-id="empty-new">
          {t('state.emptyCta')}
        </a>
      </StateCard>
    );
  else
    body = (
      <ul className="plan-list" data-id="plan-list">
        {plans.map((plan) => {
          const sharePage = `/plans/${encodeURIComponent(plan.id)}`;
          return (
            <li key={plan.id} className="card plan-item" data-id={`plan-item-${plan.id}`}>
              <div className="row-between">
                <h2 className="item-title">
                  <a href={plan.shareUrl ? sharePath(plan.shareUrl) : sharePage}>{plan.title}</a>
                </h2>
                <span className={plan.status === 'locked' || plan.status === 'done' ? 'pill pill-lock' : 'pill'}>{t(`plan.status.${plan.status}`)}</span>
              </div>
              <p className="muted">
                {t('list.people', { n: plan.participantCount })} · {t('list.deadline', { when: formatVnDateTime(plan.voteDeadline, locale) })}
              </p>
              <div className="row">
                {plan.shareUrl && (
                  <a className="btn btn-ghost btn-sm" href={sharePath(plan.shareUrl)}>
                    {t('list.open')}
                  </a>
                )}
                <a className="btn btn-text" href={sharePage}>
                  <Icon name="share" />
                  {t('list.share')}
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="column stack-lg">
      <div className="row-between">
        <h1 className="title">{t('list.title')}</h1>
        <a className="btn btn-primary btn-sm" href={NEW_PLAN_PATH} data-id="list-new">
          <Icon name="plus" />
          {t('list.new')}
        </a>
      </div>
      {body}
    </div>
  );
}
