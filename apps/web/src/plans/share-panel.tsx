/**
 * "Send this link to your group" (mockup screen 03): the link with a copy button, the device's share sheet with a
 * ready invite, and how the link will look in the group chat. A plan whose link cannot be shown again offers a new one.
 */
import { type ReactNode, useState } from 'react';
import { type PlanView, rotateLink, sharePath } from '../api/plans-api';
import { BRAND_MARK_SRC } from '../brand';
import { useI18n } from '../i18n/i18n';
import { Icon } from '../ui/icon';
import { errorMessage } from './error-message';
import { FormError, StateCard } from './plan-parts';
import { copyText, shareOrCopy, useFlag } from './share-actions';

export function SharePanel({ plan, onRotated }: { plan: PlanView; onRotated(): void }): ReactNode {
  const { t } = useI18n();
  const [copied, flagCopied] = useFlag();
  const [sharedCopied, flagSharedCopied] = useFlag();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const share = plan.share ?? null;

  async function rotate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await rotateLink(plan.id ?? '');
      onRotated();
    } catch (failure) {
      setError(errorMessage(failure, t));
    } finally {
      setBusy(false);
    }
  }

  if (!share) {
    return (
      <StateCard icon="linkOff" title={t('share.missingTitle')} text={t('share.missingText')} dataId="share-missing">
        <FormError message={error} dataId="share-error" />
        {plan.can.rotateLink && (
          <button type="button" className="btn btn-primary btn-sm" aria-busy={busy} disabled={busy} onClick={() => void rotate()} data-id="share-rotate">
            {t('share.rotate')}
          </button>
        )}
      </StateCard>
    );
  }

  const invite = t('share.invite', { title: plan.title, link: share.url });
  const shown = share.url.replace(/^https?:\/\//, '');

  async function copyLink(url: string): Promise<void> {
    if (await copyText(url)) flagCopied();
    else setError(t('share.copyFailed'));
  }

  async function shareInvite(url: string): Promise<void> {
    setError(null);
    // The share sheet gets the sentence and the link apart (apps add the link themselves); the clipboard both.
    const outcome = await shareOrCopy({ title: plan.title, text: t('share.invite', { title: plan.title, link: '' }).trim(), url }, invite);
    if (outcome === 'copied') flagSharedCopied();
    else if (outcome === 'failed') setError(t('share.copyFailed'));
  }

  return (
    <div className="share-panel" data-id="share-panel">
      <p className="eyebrow">{t('share.eyebrow')}</p>
      <h1 className="title">{t('share.title')}</h1>
      <div className="linkbox">
        <code title={share.url} aria-label={t('share.link')} data-id="share-url">
          {shown}
        </code>
        <button type="button" className={copied ? 'btn btn-ghost btn-sm is-done' : 'btn btn-ghost btn-sm'} aria-live="polite" onClick={() => void copyLink(share.url)} data-id="share-copy">
          <Icon name={copied ? 'check' : 'copy'} />
          {copied ? t('share.copied') : t('share.copy')}
        </button>
      </div>
      <button type="button" className="btn btn-primary" aria-live="polite" onClick={() => void shareInvite(share.url)} data-id="share-native">
        <Icon name={sharedCopied ? 'check' : 'share'} />
        {sharedCopied ? t('share.sharedCopied') : t('share.share')}
      </button>
      <FormError message={error} dataId="share-error" />
      <p className="eyebrow eyebrow-gap">{t('share.previewEyebrow')}</p>
      <div className="chat" aria-hidden="true">
        <div className="bubble">
          {t('share.invite', { title: plan.title, link: '' }).trim()}
          <div className="og">
            <div className="og-img">
              <img src={BRAND_MARK_SRC} width={56} height={56} alt="" />
              <span>{plan.title}</span>
            </div>
            <div className="og-txt">
              <b>{t('share.ogTitle', { title: plan.title })}</b>
              <span>{t('share.ogNote')}</span>
            </div>
          </div>
        </div>
      </div>
      <a className="btn btn-text align-center" href={sharePath(share.url)} data-id="share-open">
        {t('share.open')}
      </a>
    </div>
  );
}
