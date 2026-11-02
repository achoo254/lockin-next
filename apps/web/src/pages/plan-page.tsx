/**
 * /k/<token>: the plan page. Guests vote (no sign-in ever), the signed-in creator locks it in on the same page, and
 * once locked everyone sees the ticket. No realtime: the page loads once and on the header's refresh button.
 */
import { type ReactNode, useEffect, useState } from 'react';
import { ApiError } from '../api/api-client';
import { type PlanView, cancelPlan, fetchGuestPlan, markDone } from '../api/plans-api';
import type { SessionState } from '../api/session-api';
import { brand } from '../brand';
import { useI18n } from '../i18n/i18n';
import { LockinPage } from '../layout/lockin-page';
import { errorMessage } from '../plans/error-message';
import { LockPanel } from '../plans/lock-panel';
import { optionsOf } from '../plans/plan-format';
import { FormError, InviteCard, LoadingCard, NudgeCard, OptionRow, PlanHead, StateCard } from '../plans/plan-parts';
import { PlanTicket } from '../plans/plan-ticket';
import { VoteBoard } from '../plans/vote-board';
import { formatVnDateTime } from '../plans/vn-time';
import { Icon } from '../ui/icon';

type Load = { status: 'loading' } | { status: 'missing' } | { status: 'error'; error: unknown } | { status: 'ready'; plan: PlanView };

/** The plan of a link, as what the page shows. */
async function loadPlan(token: string): Promise<Load> {
  try {
    return { status: 'ready', plan: await fetchGuestPlan(token) };
  } catch (error) {
    return error instanceof ApiError && error.status === 404 ? { status: 'missing' } : { status: 'error', error };
  }
}

/** The page's own address without query or hash: what guests paste into the group. */
const pageLink = (): string => `${window.location.origin}${window.location.pathname}`;

/** Votes so far, read-only. */
function Tally({ plan }: { plan: PlanView }): ReactNode {
  const { t } = useI18n();
  const people = Math.max(1, plan.participants.length);
  return (
    <section className="group" aria-label={t('plan.tally')} data-id="tally">
      <p className="sec">
        <span className="sec-title">{t('plan.tally')}</span>
      </p>
      <div className="optlist">
        {[...optionsOf(plan, 'time'), ...optionsOf(plan, 'place')].map((option) => (
          <OptionRow key={option.id} option={option} area={plan.area} share={option.votes / people} />
        ))}
      </div>
    </section>
  );
}

/** The creator's actions on a locked plan: mark it done, cancel it (behind a confirm). */
function LockedActions({ plan, onChange }: { plan: PlanView; onChange(plan: PlanView): void }): ReactNode {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = plan.id ?? '';
  async function run(action: () => Promise<PlanView>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
    } catch (failure) {
      setError(errorMessage(failure, t));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }
  if (!plan.can.done && !plan.can.cancel) return null;
  return (
    <div className="stack">
      <FormError message={error} dataId="locked-error" />
      {confirm ? (
        <div className="confirm" role="group" aria-label={t('lock.cancel')}>
          <p>{t('lock.cancelConfirm')}</p>
          <div className="row">
            <button type="button" className="btn btn-text danger" disabled={busy} onClick={() => void run(() => cancelPlan(id))} data-id="confirm-yes">
              {t('lock.confirmYes')}
            </button>
            <button type="button" className="btn btn-text" onClick={() => setConfirm(false)}>
              {t('lock.confirmNo')}
            </button>
          </div>
        </div>
      ) : (
        <div className="row row-center">
          {plan.can.done && (
            <button type="button" className="btn btn-text" disabled={busy} onClick={() => void run(() => markDone(id))} data-id="plan-done">
              {t('lock.done')}
            </button>
          )}
          {plan.can.cancel && (
            <button type="button" className="btn btn-text danger" onClick={() => setConfirm(true)} data-id="lock-cancel">
              {t('lock.cancel')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PlanBody({ plan, token, signedIn, onChange }: { plan: PlanView; token: string; signedIn: boolean; onChange(plan: PlanView): void }): ReactNode {
  const { t, locale } = useI18n();
  const [sentNow, setSentNow] = useState(false);
  const now = new Date();
  const isCreator = plan.viewer.isCreator;
  const link = isCreator ? (plan.share?.url ?? pageLink()) : pageLink();
  const me = plan.participants.find((person) => person.id === plan.viewer.participantId) ?? null;
  const hasVoted = sentNow || (me !== null && (me.optionIds.length > 0 || me.rsvp !== null));

  if (plan.status === 'cancelled' || plan.status === 'expired') {
    return (
      <>
        <PlanHead plan={plan} now={now} invite={false} />
        {plan.status === 'cancelled' ? (
          <StateCard icon="lock" title={t('state.cancelledTitle')} text={t('state.cancelledText')} tone="error" dataId="state-cancelled" />
        ) : (
          <StateCard icon="clock" title={t('state.readOnlyTitle')} text={t('state.readOnlyText')} dataId="state-expired" />
        )}
        <Tally plan={plan} />
        {!isCreator && <InviteCard signedIn={signedIn} />}
      </>
    );
  }

  if (plan.status === 'locked' || plan.status === 'done') {
    return (
      <>
        <PlanTicket plan={plan} link={link} />
        {isCreator && <LockedActions plan={plan} onChange={onChange} />}
        {!isCreator && plan.can.rsvp && (
          <VoteBoard key={`rsvp-${plan.viewer.participantId ?? 'new'}`} plan={plan} token={token} mode="rsvp" onChange={onChange} onSent={() => setSentNow(true)} />
        )}
        {!isCreator && <InviteCard signedIn={signedIn} />}
      </>
    );
  }

  if (isCreator) {
    return (
      <>
        <PlanHead plan={plan} now={now} invite={false} />
        {plan.can.vote && <NudgeCard plan={plan} link={link} />}
        <LockPanel key={plan.options.map((option) => option.id).join()} plan={plan} onChange={onChange} onRotated={() => window.location.assign(`/plans/${encodeURIComponent(plan.id ?? '')}`)} />
      </>
    );
  }

  return (
    <>
      <PlanHead plan={plan} now={now} invite />
      {!plan.can.vote && (
        <StateCard icon="clock" title={t('state.expiredVoteTitle')} text={t('state.expiredVoteText')} dataId="state-deadline">
          <span className="pill pill-warn">{t('state.expiredAt', { when: formatVnDateTime(plan.voteDeadline, locale) })}</span>
        </StateCard>
      )}
      {!plan.can.vote && <Tally plan={plan} />}
      {hasVoted && plan.can.vote && <NudgeCard plan={plan} link={link} />}
      <VoteBoard plan={plan} token={token} mode={plan.can.vote ? 'vote' : 'rsvp'} onChange={onChange} onSent={() => setSentNow(true)} />
      {hasVoted && <InviteCard signedIn={signedIn} />}
    </>
  );
}

export function PlanPage({ token, path, session }: { token: string; path: string; session: SessionState }): ReactNode {
  const { t } = useI18n();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const signedIn = session.status === 'ready' && session.signedIn;

  useEffect(() => {
    let live = true;
    void loadPlan(token).then((next) => {
      if (live) setLoad(next);
    });
    return () => {
      live = false;
    };
  }, [token]);

  const title = load.status === 'ready' ? load.plan.title : load.status === 'missing' ? t('state.missingTitle') : t('state.loading');
  useEffect(() => {
    document.title = `${title} · ${brand.appName}`;
  }, [title]);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      setLoad(await loadPlan(token));
    } finally {
      setRefreshing(false);
    }
  }

  const actions = (
    <button type="button" className="icon-btn" aria-label={t('layout.refresh')} aria-busy={refreshing} disabled={refreshing} onClick={() => void refresh()} data-id="plan-refresh">
      <Icon name="refresh" className={refreshing ? 'spin' : undefined} />
    </button>
  );

  let body: ReactNode;
  if (load.status === 'loading') body = <LoadingCard />;
  else if (load.status === 'missing') body = <StateCard icon="linkOff" title={t('state.missingTitle')} text={t('state.missingText')} tone="error" dataId="state-missing" />;
  else if (load.status === 'error')
    body = (
      <StateCard icon="refresh" title={t('state.errorTitle')} text={errorMessage(load.error, t)} tone="error" dataId="state-error">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void refresh()}>
          {t('state.retry')}
        </button>
      </StateCard>
    );
  else body = <PlanBody plan={load.plan} token={token} signedIn={signedIn} onChange={(plan) => setLoad({ status: 'ready', plan })} />;

  return (
    <LockinPage path={path} session={session} actions={actions} guestPage>
      <div className="column stack-lg" data-id="plan-page">
        {body}
      </div>
    </LockinPage>
  );
}
