/**
 * Saving a plan made signed out to an account. Such a plan lives in the creator's browser (its creator cookie) and
 * in its private manage link; the card here shows that link to keep (and to change, when it went to the wrong person),
 * and offers to save the plan to a hoandat.com account. Signed out, the offer goes through sign-up (or sign-in) and
 * comes back with `?claim=<plan id>`, which useClaimFromUrl turns into the save. Once saved, the account is the plan's
 * only key; ManageLinkCard then shows the (new) manage link to its owner, with the same way to change it.
 */
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type ManageLink, type PlanView, claimPlan, rotateManageLink } from '../api/plans-api';
import { type SessionState, signInHref, signUpHref } from '../api/session-api';
import { brand } from '../brand';
import { useI18n } from '../i18n/i18n';
import { Icon } from '../ui/icon';
import { errorMessage } from './error-message';
import { FormError } from './plan-parts';
import { copyText, useFlag } from './share-actions';

const CLAIM_PARAM = 'claim';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where sign-in comes back to for saving the plan: this page, asking to save it. */
export function claimReturnPath(path: string, planId: string): string {
  return `${path}?${new URLSearchParams({ [CLAIM_PARAM]: planId }).toString()}`;
}

/** The plan id of `?claim=` in the address, when it is one. */
export function claimParam(search: string): string | null {
  const value = new URLSearchParams(search).get(CLAIM_PARAM);
  return value !== null && UUID.test(value) ? value : null;
}

export type ClaimState = { status: 'idle' } | { status: 'claiming' } | { status: 'failed'; error: unknown };

/**
 * Back from sign-in with `?claim=<plan id>`: saves that plan to the account (this browser's creator cookie is the
 * proof), drops the parameter from the address and hands the saved plan to `onClaimed`.
 */
export function useClaimFromUrl(session: SessionState, onClaimed: (plan: PlanView) => void): ClaimState {
  const [state, setState] = useState<ClaimState>({ status: 'idle' });
  const started = useRef(false);
  const callback = useRef(onClaimed);
  useEffect(() => {
    callback.current = onClaimed;
  });
  const signedIn = session.status === 'ready' && session.signedIn;

  useEffect(() => {
    const planId = claimParam(window.location.search);
    if (!signedIn || planId === null || started.current) return;
    started.current = true;
    setState({ status: 'claiming' });
    claimPlan(planId).then(
      (plan) => {
        window.history.replaceState(null, '', window.location.pathname);
        setState({ status: 'idle' });
        callback.current(plan);
      },
      (error: unknown) => setState({ status: 'failed', error }),
    );
  }, [signedIn]);
  return state;
}

/** What saving from the address is doing, above the page. */
export function ClaimNotice({ state }: { state: ClaimState }): ReactNode {
  const { t } = useI18n();
  if (state.status === 'claiming') {
    return (
      <p className="alert alert-info" role="status" data-id="claim-busy">
        {t('claim.busy')}
      </p>
    );
  }
  if (state.status === 'failed') return <FormError message={errorMessage(state.error, t)} dataId="claim-error" />;
  return null;
}

/** Whether this browser shows something for the first time (remembered in localStorage under `key`). */
function useFirstTime(key: string): boolean {
  const [first] = useState(() => {
    try {
      return window.localStorage.getItem(key) === null;
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      // Storage refused (private mode): the offer may show again, nothing else.
    }
  }, [key]);
  return first;
}

interface SavePlanCardProps {
  /** The creator's view of a plan not saved to an account (`savedToAccount` false). */
  plan: PlanView;
  session: SessionState;
  /** This page's path, where sign-in comes back to save the plan. */
  returnPath: string;
  /** "full": the manage link and the offer (share screen); "locked": only the offer, once per plan (locked ticket). */
  variant: 'full' | 'locked';
  /** After the plan is saved from this card (signed in already), or its manage link changed. */
  onSaved(plan: PlanView): void;
}

function SaveOffer({ plan, session, returnPath, onSaved }: Omit<SavePlanCardProps, 'variant'>): ReactNode {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domain = brand.primaryTenant.domain;
  const id = plan.id ?? '';

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onSaved(await claimPlan(id));
    } catch (failure) {
      setError(errorMessage(failure, t));
      setBusy(false);
    }
  }

  if (session.status === 'ready' && session.signedIn) {
    return (
      <div className="save-card-actions">
        <button type="button" className="btn btn-primary btn-sm" aria-busy={busy} disabled={busy} onClick={() => void save()} data-id="save-account">
          <Icon name="lock" />
          {busy ? t('save.saving') : t('save.cta', { domain })}
        </button>
        <FormError message={error} dataId="save-error" />
      </div>
    );
  }
  // Sign-in is not set up on this server: nothing to offer.
  if (session.status === 'ready' && !session.signInAvailable) return null;
  const back = claimReturnPath(returnPath, id);
  return (
    <div className="save-card-actions">
      <a className="btn btn-primary btn-sm" href={signUpHref(locale, back)} data-id="save-account">
        <Icon name="lock" />
        {t('save.cta', { domain })}
      </a>
      <a className="btn btn-text" href={signInHref(locale, back)} data-id="save-sign-in">
        {t('save.haveAccount')}
      </a>
    </div>
  );
}

/**
 * The plan's manage link with its copy button, and the button that replaces it (the old link and every browser it got
 * in stop working). `onRotated` gets the new link.
 */
function ManageLinkBox({ plan, warn, onRotated }: { plan: PlanView; warn: string; onRotated(manage: ManageLink): void }): ReactNode {
  const { t } = useI18n();
  const [copied, flagCopied] = useFlag();
  const [rotated, setRotated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manage = plan.manage ?? null;
  if (!manage) return null;

  async function copy(url: string): Promise<void> {
    setError(null);
    if (await copyText(url)) flagCopied();
    else setError(t('share.copyFailed'));
  }

  async function rotate(): Promise<void> {
    setBusy(true);
    setError(null);
    setRotated(false);
    try {
      onRotated(await rotateManageLink(plan.id ?? ''));
      setRotated(true);
    } catch (failure) {
      setError(errorMessage(failure, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="linkbox">
        <code title={manage.url} aria-label={t('save.link')} data-id="manage-url">
          {manage.url.replace(/^https?:\/\//, '')}
        </code>
        <button
          type="button"
          className={copied ? 'btn btn-ghost btn-sm is-done' : 'btn btn-ghost btn-sm'}
          aria-live="polite"
          onClick={() => void copy(manage.url)}
          data-id="manage-copy"
        >
          <Icon name={copied ? 'check' : 'copy'} />
          {copied ? t('save.copied') : t('save.copy')}
        </button>
      </div>
      <p className="alert alert-warn" data-id="manage-warn">
        {warn}
      </p>
      <p className="muted" data-id="manage-rotate-note">
        {t('manage.rotateNote')}
      </p>
      <button type="button" className="btn btn-text" aria-busy={busy} disabled={busy} onClick={() => void rotate()} data-id="manage-rotate">
        <Icon name="refresh" />
        {busy ? t('manage.rotating') : t('manage.rotate')}
      </button>
      {rotated && (
        <p className="alert alert-info" role="status" data-id="manage-rotated">
          {t('manage.rotated')}
        </p>
      )}
      <FormError message={error} dataId="manage-error" />
    </>
  );
}

/** The "full" card on the share screen. */
function FullCard(props: Omit<SavePlanCardProps, 'variant'>): ReactNode {
  const { t } = useI18n();
  const { plan, session, onSaved } = props;
  const signedIn = session.status === 'ready' && session.signedIn;

  return (
    <section className="card save-card" aria-labelledby="save-card-title" data-id="save-card">
      <h2 className="save-card-title" id="save-card-title">
        {t('save.title')}
      </h2>
      <p className="muted">{signedIn ? t('save.signedInText') : t('save.text')}</p>
      <ManageLinkBox plan={plan} warn={t('save.warn')} onRotated={(manage) => onSaved({ ...plan, manage })} />
      <SaveOffer {...props} />
    </section>
  );
}

/**
 * The manage link of a plan saved to an account, for its owner (share screen): it only leads to the plan's management
 * page, where the account signs in; it can still be changed.
 */
export function ManageLinkCard({ plan, onRotated }: { plan: PlanView; onRotated(plan: PlanView): void }): ReactNode {
  const { t } = useI18n();
  if (!plan.viewer.isCreator || plan.savedToAccount !== true || !plan.manage) return null;
  return (
    <section className="card save-card" aria-labelledby="manage-card-title" data-id="manage-card">
      <h2 className="save-card-title" id="manage-card-title">
        {t('manage.savedTitle')}
      </h2>
      <ManageLinkBox plan={plan} warn={t('manage.savedText')} onRotated={(manage) => onRotated({ ...plan, manage })} />
    </section>
  );
}

/** The "locked" card under the ticket: shown the first time this browser sees the plan locked. */
function LockedCard(props: Omit<SavePlanCardProps, 'variant'>): ReactNode {
  const { t } = useI18n();
  const first = useFirstTime(`lockin_save_offer_${props.plan.id ?? ''}`);
  if (!first) return null;
  return (
    <aside className="card save-card" aria-labelledby="save-locked-title" data-id="save-card-locked">
      <h2 className="save-card-title" id="save-locked-title">
        {t('save.lockedTitle')}
      </h2>
      <p className="muted">{t('save.lockedText', { domain: brand.primaryTenant.domain })}</p>
      <SaveOffer {...props} />
    </aside>
  );
}

/** Nothing once the plan is saved to an account, or for anyone but its creator. */
export function SavePlanCard({ variant, ...props }: SavePlanCardProps): ReactNode {
  if (!props.plan.viewer.isCreator || props.plan.savedToAccount !== false) return null;
  return variant === 'full' ? <FullCard {...props} /> : <LockedCard {...props} />;
}
