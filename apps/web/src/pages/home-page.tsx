import type { ReactNode } from 'react';
import type { SessionState } from '../api/session-api';
import { type Translate, useI18n } from '../i18n/i18n';
import { Icon } from '../ui/icon';
import { MY_PLANS_PATH } from './my-plans-page';
import { NEW_PLAN_PATH } from './new-plan-page';

export { NEW_PLAN_PATH } from './new-plan-page';

/** What the address says on arriving home, if anything: `?login=` back from sign-in, `?manage=invalid` from a bad manage link. */
export function homeNotice(search: string, t: Translate): string | null {
  const query = new URLSearchParams(search);
  if (query.get('manage') === 'invalid') return t('manage.invalid');
  const login = query.get('login');
  if (login === 'fail') return t('login.fail');
  if (login === 'unavailable') return t('login.unavailable');
  if (login === 'busy') return t('login.busy');
  return null;
}

/** A made-up plan drawn like the real vote board, plus a work example, so friends and coworkers see it fits them. */
function SamplePlans(): ReactNode {
  const { t } = useI18n();
  return (
    <div className="samples" data-id="sample-plan" role="img" aria-label={t('sample.label')}>
      <div className="card sample" aria-hidden="true">
        <p className="eyebrow">{t('sample.eyebrow')}</p>
        <strong>{t('sample.title')}</strong>
        <div className="meta">
          <span className="pill">{t('sample.area')}</span>
          <span className="pill">{t('sample.budget')}</span>
          <span className="pill pill-warn">{t('sample.deadline')}</span>
        </div>
        <div className="optlist">
          <div className="opt is-picked">
            <span className="box">
              <Icon name="check" />
            </span>
            <span className="lbl">{t('sample.time1')}</span>
            <span className="n">4</span>
          </div>
          <div className="opt">
            <span className="box" />
            <span className="lbl">{t('sample.time2')}</span>
            <span className="n">2</span>
          </div>
        </div>
      </div>
      <div className="card sample-work" aria-hidden="true" data-id="sample-work">
        <span className="sample-emoji">🍱</span>
        <div>
          <strong>{t('sample.workTitle')}</strong>
          <p className="muted">{t('sample.work')}</p>
        </div>
      </div>
    </div>
  );
}

const STEPS = ['home.step1', 'home.step2', 'home.step3', 'home.step4'] as const;

/**
 * The welcome (mockup screen 01): one value line, sample plans, the four steps and one main button, straight to the
 * form (no account needed to make a plan). "Kèo của tôi" lists the account's plans and this browser's.
 */
export function HomePage({ session }: { session: SessionState }): ReactNode {
  const { t } = useI18n();
  const ready = session.status === 'ready';
  const notice = homeNotice(window.location.search, t);

  return (
    <div className="home" data-id="home">
      {notice && (
        <p className="alert alert-info" role="status" data-id="login-notice">
          {notice}
        </p>
      )}
      <section className="hero" data-id="hero">
        <h1 className="hero-title">
          {t('home.titleStart')} <em>{t('home.titleEm')}</em>
        </h1>
        <p className="muted hero-lead">{t('home.lead')}</p>
      </section>
      <SamplePlans />
      <ol className="steps" aria-label={t('home.steps')} data-id="steps">
        {STEPS.map((key, index) => (
          <li key={key} data-id={`step-${index + 1}`}>
            <span className="step-n" aria-hidden="true">
              {index + 1}
            </span>
            {t(key)}
          </li>
        ))}
      </ol>
      <div className="action-bar home-cta">
        <a className="btn btn-primary" href={NEW_PLAN_PATH} data-id="create-plan">
          <Icon name="plus" />
          {t('home.cta')}
        </a>
        {ready && (
          <a className="btn btn-text align-center" href={MY_PLANS_PATH} data-id="home-my-plans">
            {t('home.myPlans')}
          </a>
        )}
        <p className="help">{t('home.help')}</p>
      </div>
    </div>
  );
}
