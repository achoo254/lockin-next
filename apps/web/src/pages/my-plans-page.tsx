import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { type PlanSummary, listPlans, sharePath } from '../api/plans-api';
import { type SessionState, signInHref } from '../api/session-api';
import { useI18n } from '../i18n/i18n';
import { errorMessage } from '../plans/error-message';
import { LoadingCard, StateCard } from '../plans/plan-parts';
import { formatVnDateTime } from '../plans/vn-time';
import { Icon } from '../ui/icon';
import { NEW_PLAN_PATH } from './new-plan-page';

export const MY_PLANS_PATH = '/plans';

/**
 * /plans: the plans this person manages, newest first: the account's (signed in) and those made in this browser
 * (its creator cookies). Signed out, a note says how to see them on any device.
 */
export function MyPlansPage({ session }: { session: SessionState }): ReactNode {
  const { t, locale } = useI18n();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ready = session.status === 'ready';
  const canSignIn = ready && !session.signedIn && session.signInAvailable;

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
    if (!ready) return;
    let live = true;
    listPlans().then(
      (value) => live && setPlans(value),
      (failure: unknown) => live && setError(failure),
    );
    return () => {
      live = false;
    };
  }, [ready]);

  if (!ready) return <LoadingCard />;

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
              {!plan.savedToAccount && (
                <p>
                  <span className="pill pill-warn" data-id="plan-browser-only">
                    {t('list.browserOnly')}
                  </span>
                </p>
              )}
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
      {canSignIn && (
        <p className="alert alert-info" data-id="list-sign-in-hint">
          {t('list.signInHint')}{' '}
          <a href={signInHref(locale, MY_PLANS_PATH)} data-id="list-sign-in">
            {t('layout.signIn')}
          </a>
        </p>
      )}
      {body}
    </div>
  );
}
