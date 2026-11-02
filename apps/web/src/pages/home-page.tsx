import type { ReactNode } from 'react';
import { type SessionState, signInHref } from '../api/session-api';
import { brand } from '../brand';
import { type Translate, useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';

/** Where making a plan starts (the page itself comes with the plan screens). */
export const NEW_PLAN_PATH = '/new';

/** What `?login=` on the way back from sign-in says, if anything. */
export function loginNotice(search: string, t: Translate): string | null {
  const login = new URLSearchParams(search).get('login');
  if (login === 'fail') return t('login.fail');
  if (login === 'unavailable') return t('login.unavailable');
  if (login === 'busy') return t('login.busy');
  return null;
}

/** "Make a plan": straight there when signed in, otherwise through sign-in and back to it. */
export function createPlanHref(session: SessionState, locale: string): string {
  return session.status === 'ready' && session.signedIn ? NEW_PLAN_PATH : signInHref(locale, NEW_PLAN_PATH);
}

interface SampleOption {
  label: MessageKey;
  votes: number;
  /** Initials of who voted; made up for the sample. */
  voters: string[];
  locked?: boolean;
}

const SAMPLE_TIMES: SampleOption[] = [
  { label: 'sample.time1', votes: 4, voters: ['M', 'T', 'H', 'L'], locked: true },
  { label: 'sample.time2', votes: 2, voters: ['A', 'T'] },
];
const SAMPLE_PLACES: SampleOption[] = [
  { label: 'sample.place1', votes: 3, voters: ['M', 'H', 'A'], locked: true },
  { label: 'sample.place2', votes: 2, voters: ['T', 'L'] },
];
const SAMPLE_GROUP = 5;

function SampleOptions({ heading, options }: { heading: MessageKey; options: SampleOption[] }): ReactNode {
  const { t } = useI18n();
  return (
    <div className="sample-group">
      <p className="sample-heading">{t(heading)}</p>
      <ul className="sample-options">
        {options.map((option) => (
          <li key={option.label} className={option.locked ? 'sample-option is-locked' : 'sample-option'}>
            <div className="sample-option-row">
              <span className="sample-option-label">{t(option.label)}</span>
              <span className="sample-option-votes">{t('sample.votes', { n: option.votes })}</span>
            </div>
            {/* The share of the group that picked it, as a bar. */}
            <span className="sample-bar" style={{ inlineSize: `${(option.votes / SAMPLE_GROUP) * 100}%` }} />
            <span className="sample-voters">
              {option.voters.map((initial, index) => (
                <span key={`${initial}-${index}`} className="sample-avatar">
                  {initial}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A made-up plan drawn in HTML and CSS, so visitors see what their friends will get. Decorative for screen readers. */
function SamplePlan(): ReactNode {
  const { t } = useI18n();
  return (
    <figure className="sample" data-id="sample-plan" aria-label={t('sample.label')}>
      <div className="sample-card" aria-hidden="true">
        <div className="sample-head">
          <span className="sample-tag">{t('sample.label')}</span>
          <span className="sample-stamp">{t('sample.locked')}</span>
        </div>
        <p className="sample-title">{t('sample.title')}</p>
        <p className="sample-meta">{t('sample.meta')}</p>
        <p className="sample-deadline">{t('sample.deadline')}</p>
        <SampleOptions heading="sample.time" options={SAMPLE_TIMES} />
        <SampleOptions heading="sample.place" options={SAMPLE_PLACES} />
        <p className="sample-going">{t('sample.going', { n: 4 })}</p>
      </div>
    </figure>
  );
}

const STEPS = ['create', 'share', 'lock'] as const;

function Steps(): ReactNode {
  const { t } = useI18n();
  return (
    <section className="steps" aria-labelledby="steps-title" data-id="steps">
      <h2 id="steps-title" className="section-title">
        {t('steps.title')}
      </h2>
      <ol className="step-list">
        {STEPS.map((id, index) => (
          <li key={id} className="card step" data-id={`step-${id}`}>
            <span className="step-number" aria-hidden="true">
              {index + 1}
            </span>
            <h3 className="step-title">{t(`steps.${id}.title`)}</h3>
            <p className="step-text">{t(`steps.${id}.text`)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The welcome: what the app does, a sample plan and the "make a plan" button. */
export function HomePage({ session }: { session: SessionState }): ReactNode {
  const { t, locale } = useI18n();
  const signedIn = session.status === 'ready' && session.signedIn;
  const notice = loginNotice(window.location.search, t);

  return (
    <div className="home">
      {notice && (
        <p className="alert alert-info" role="status" data-id="login-notice">
          {notice}
        </p>
      )}
      <section className="hero" data-id="hero">
        <div className="hero-intro">
          <h1 className="hero-title">{t('intro.title')}</h1>
          <p className="hero-lede">{t('intro.lead')}</p>
          <div className="hero-actions">
            <a className="btn btn-primary btn-cta" href={createPlanHref(session, locale)} data-id="create-plan">
              {t('intro.cta')}
            </a>
          </div>
          <p className="hero-note">{signedIn ? t('intro.memberNote') : t('intro.guestNote', { domain: brand.primaryTenant.domain })}</p>
        </div>
        <SamplePlan />
      </section>
      <Steps />
    </div>
  );
}
