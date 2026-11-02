import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/api-client';
import { type PlanView, fetchCreatorPlan } from '../api/plans-api';
import { type SessionState, signInHref } from '../api/session-api';
import { useI18n } from '../i18n/i18n';
import { SignInCard } from '../layout/sign-in-card';
import { errorMessage } from '../plans/error-message';
import { LoadingCard, StateCard } from '../plans/plan-parts';
import { SharePanel } from '../plans/share-panel';

/** /plans/<id>: send the plan's link to the group (right after making it, or later from "Kèo của tôi"). */
export function SharePage({ planId, path, session }: { planId: string; path: string; session: SessionState }): ReactNode {
  const { t, locale } = useI18n();
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const signedIn = session.status === 'ready' && session.signedIn;

  /** Loads once more, after a failure or a new link. */
  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setPlan(await fetchCreatorPlan(planId));
    } catch (failure) {
      setError(failure);
    }
  }, [planId]);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetchCreatorPlan(planId).then(
      (value) => live && setPlan(value),
      (failure: unknown) => live && setError(failure),
    );
    return () => {
      live = false;
    };
  }, [signedIn, planId]);

  if (session.status === 'loading') return <LoadingCard />;
  if (!signedIn) return <SignInCard href={signInHref(locale, path)} title={t('signIn.title')} description={t('signIn.lead')} headingLevel={1} />;
  if (error) {
    const missing = error instanceof ApiError && (error.status === 404 || error.status === 403);
    return missing ? (
      <StateCard icon="linkOff" title={t('state.missingTitle')} text={errorMessage(error, t)} tone="error" dataId="state-missing" />
    ) : (
      <StateCard icon="refresh" title={t('state.errorTitle')} text={errorMessage(error, t)} tone="error" dataId="state-error">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()}>
          {t('state.retry')}
        </button>
      </StateCard>
    );
  }
  if (!plan) return <LoadingCard />;
  return (
    <div className="column">
      <SharePanel plan={plan} onRotated={() => void load()} />
    </div>
  );
}
