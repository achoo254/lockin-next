import type { ReactNode } from 'react';
import { BRAND_MARK_SRC } from '../brand';
import { useI18n } from '../i18n/i18n';

/** Stands in for a page that is not built yet: making a plan (`new`) or a shared plan link (`plan`). */
export function ComingSoonPage({ kind }: { kind: 'new' | 'plan' }): ReactNode {
  const { t } = useI18n();
  return (
    <section className="card soon" data-id={`coming-soon-${kind}`}>
      <img className="sign-in-mark" src={BRAND_MARK_SRC} width={72} height={72} alt="" aria-hidden="true" decoding="async" />
      <h1 className="sign-in-title">{t('soon.title')}</h1>
      <p className="sign-in-lead">{kind === 'new' ? t('soon.new') : t('soon.plan')}</p>
      <a className="btn btn-secondary" href="/" data-id="coming-soon-home">
        {t('soon.back')}
      </a>
    </section>
  );
}
