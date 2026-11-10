/** Small pieces shared by the plan screens: the plan's heading, option rows, people chips, state cards, nudge, invite. */
import type { ReactNode } from 'react';
import { type PlanOption, type PlanView, RSVPS, type Rsvp } from '../api/plans-api';
import { useI18n } from '../i18n/i18n';
import { Icon, type IconName } from '../ui/icon';
import { mapHref, nudgeLine, optionText, reminderText } from './plan-format';
import { copyText, useFlag } from './share-actions';
import { formatDong, formatLeft, formatVnDateTime } from './vn-time';

/** Title, who invites, and the pills (area, budget, deadline). */
export function PlanHead({ plan, now, invite }: { plan: PlanView; now: Date; invite: boolean }): ReactNode {
  const { t, locale } = useI18n();
  const left = formatLeft(new Date(plan.voteDeadline), now, t);
  return (
    <div className="plan-head" data-id="plan-head">
      {invite && (
        <p className="muted">
          {plan.creatorName ? (
            <>
              <strong className="ink">{plan.creatorName}</strong> {t('plan.invitedBy')}
            </>
          ) : (
            t('plan.invited')
          )}
        </p>
      )}
      <div className="row-between">
        <h1 className="title" data-id="plan-title">
          {plan.title}
        </h1>
        {!invite && <span className={plan.status === 'locked' || plan.status === 'done' ? 'pill pill-lock' : 'pill'}>{t(`plan.status.${plan.status}`)}</span>}
      </div>
      <div className="meta">
        {plan.area && <span className="pill">{plan.area}</span>}
        {plan.budgetPerPerson !== null && <span className="pill">{t('plan.budget', { amount: formatDong(plan.budgetPerPerson, locale) })}</span>}
        {plan.status === 'open' && (
          <span className="pill pill-warn" data-id="plan-deadline" title={formatVnDateTime(plan.voteDeadline, locale)}>
            {left ? t('plan.deadlineLeft', { left }) : t('plan.deadlinePassed')}
          </span>
        )}
      </div>
    </div>
  );
}

interface OptionRowProps {
  option: PlanOption;
  /** The plan's area, for the map search of a place. */
  area: string | null;
  /** Share of the people in the plan who picked it (0–1), drawn as a bar; null for no bar. */
  share: number | null;
  pressed?: boolean;
  /** "lime" for the locked-in or chosen option. */
  win?: boolean;
  note?: string;
  onClick?: () => void;
  role?: 'radio';
  disabled?: boolean;
}

/** One option: a button when it can be picked, a row otherwise. */
export function OptionRow({ option, area, share, pressed, win, note, onClick, role, disabled }: OptionRowProps): ReactNode {
  const { t, locale } = useI18n();
  const checked = pressed === true || win === true;
  const content = (
    <>
      <span className="box" aria-hidden="true">
        {checked && <Icon name="check" />}
      </span>
      <span className="lbl">
        {optionText(option, locale)}
        {note && <small>{note}</small>}
      </span>
      <span className="n" title={t('plan.votes', { n: option.votes })}>
        <span aria-hidden="true">{option.votes}</span>
        <span className="sr-only">{t('plan.votes', { n: option.votes })}</span>
      </span>
      {share !== null && <span className="bar" style={{ inlineSize: `${Math.round(share * 100)}%` }} aria-hidden="true" />}
    </>
  );
  // A radio (pick exactly one, as when locking in) gets a round mark, so it does not look like a multi-pick vote.
  const className = `opt${win ? ' win' : ''}${role === 'radio' ? ' radio' : ''}`;
  const row = !onClick ? (
    <div className={className}>{content}</div>
  ) : (
    <button
      type="button"
      className={className}
      {...(role === 'radio' ? { role: 'radio', 'aria-checked': checked } : { 'aria-pressed': checked })}
      disabled={disabled}
      onClick={onClick}
      data-id={`option-${option.id}`}
    >
      {content}
    </button>
  );
  if (option.kind !== 'place') return row;
  // A link cannot sit inside the option's button: it goes beside it.
  return (
    <div className="opt-line">
      {row}
      <a className="map-link" href={mapHref(option, area)} target="_blank" rel="noopener noreferrer" data-id={`map-${option.id}`}>
        <Icon name="pin" />
        <span>{t('plan.mapLink')}</span>
      </a>
    </div>
  );
}

/** The going / maybe / no switch. */
export function RsvpSwitch({ value, onChange, disabled }: { value: Rsvp | null; onChange: (rsvp: Rsvp) => void; disabled?: boolean }): ReactNode {
  const { t } = useI18n();
  return (
    <div className="seg" role="group" aria-label={t('plan.rsvpHeading')} data-id="rsvp">
      {RSVPS.map((rsvp) => (
        <button key={rsvp} type="button" aria-pressed={value === rsvp} disabled={disabled} onClick={() => onChange(rsvp)} data-id={`rsvp-${rsvp}`}>
          {t(`plan.rsvp.${rsvp}`)}
        </button>
      ))}
    </div>
  );
}

/** First letter of a name for its avatar dot. */
const initial = (name: string): string => Array.from(name.trim())[0]?.toUpperCase() ?? '?';

export function PersonChip({ name, faded, note }: { name: string; faded?: boolean; note?: string }): ReactNode {
  return (
    <li className={faded ? 'person no' : 'person'}>
      <i aria-hidden="true">{initial(name)}</i>
      {note ? `${name} · ${note}` : name}
    </li>
  );
}

/** A screen of its own for a state: loading, link gone, closed, empty, error. */
export function StateCard({
  icon,
  title,
  text,
  tone,
  busy,
  children,
  dataId,
}: {
  icon: IconName;
  title: string;
  text?: string;
  tone?: 'error';
  busy?: boolean;
  children?: ReactNode;
  dataId: string;
}): ReactNode {
  return (
    <section className={tone === 'error' ? 'state err' : 'state'} aria-busy={busy || undefined} data-id={dataId}>
      <span className="ic" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <h2 className="state-title">{title}</h2>
      {text && <p>{text}</p>}
      {children}
    </section>
  );
}

/** The loading state with skeleton lines. */
export function LoadingCard(): ReactNode {
  const { t } = useI18n();
  return (
    <StateCard icon="refresh" title={t('state.loading')} busy dataId="state-loading">
      <span className="sk" />
      <span className="sk sk-70" />
      <span className="sk sk-85" />
    </StateCard>
  );
}

/** The gentle "make your own plan" card for guests (straight to the form: no account needed). */
export function InviteCard(): ReactNode {
  const { t } = useI18n();
  return (
    <aside className="card invite" data-id="invite-card">
      <strong>{t('invite.title')}</strong>
      <p className="muted">{t('invite.text')}</p>
      <a className="btn btn-primary btn-sm" href="/new" data-id="invite-cta">
        {t('invite.cta')}
      </a>
    </aside>
  );
}

/** "Còn 2 người chưa vote 👀" and the reminder to paste into the group. */
export function NudgeCard({ plan, link }: { plan: PlanView; link: string }): ReactNode {
  const { t, locale } = useI18n();
  const [copied, flagCopied] = useFlag();
  const line = nudgeLine(plan);
  const text =
    line.kind === 'voted' ? t('nudge.voted', { n: line.n }) : line.kind === 'left' ? t('nudge.left', { k: line.k }) : t('nudge.all');
  return (
    <div className="card nudge" data-id="nudge">
      <strong>{text}</strong>
      <button
        type="button"
        className={copied ? 'btn btn-ghost btn-sm is-done' : 'btn btn-ghost btn-sm'}
        aria-live="polite"
        onClick={() => void copyText(reminderText(plan, link, new Date(), t, locale)).then((ok) => ok && flagCopied())}
        data-id="nudge-copy"
      >
        <Icon name={copied ? 'check' : 'copy'} />
        {copied ? t('nudge.copied') : t('nudge.copy')}
      </button>
    </div>
  );
}

/** A short error line under a form. */
export function FormError({ message, dataId }: { message: string | null; dataId: string }): ReactNode {
  if (!message) return null;
  return (
    <p className="alert alert-error" role="alert" data-id={dataId}>
      {message}
    </p>
  );
}
