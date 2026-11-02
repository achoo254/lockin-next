/**
 * The creator's side of an open plan (mockup screen 05): who voted, pick the time and the place to lock in (the one
 * with the most votes is picked for them; on a tie they choose, the app never does), "Chốt kèo!". Also change the
 * link and cancel, each behind a confirm.
 */
import { type ReactNode, useState } from 'react';
import { type PlanOption, type PlanView, cancelPlan, lockPlan, rotateLink } from '../api/plans-api';
import { useI18n } from '../i18n/i18n';
import { Icon } from '../ui/icon';
import { errorMessage } from './error-message';
import { kindLeader, optionsOf, voterCount } from './plan-format';
import { FormError, OptionRow, PersonChip } from './plan-parts';

type Confirm = 'rotate' | 'cancel' | null;

/** The pre-picked option of a kind: its unique leader, none on a tie or with no votes. */
export function initialChoice(options: PlanOption[]): string | null {
  return kindLeader(options).leaderId;
}

interface LockPanelProps {
  plan: PlanView;
  onChange(plan: PlanView): void;
  /** After the link changed: the page moves to the share screen with the new link. */
  onRotated(): void;
}

export function LockPanel({ plan, onChange, onRotated }: LockPanelProps): ReactNode {
  const { t } = useI18n();
  const id = plan.id ?? '';
  const times = optionsOf(plan, 'time');
  const places = optionsOf(plan, 'place');
  const [timeId, setTimeId] = useState<string | null>(() => initialChoice(times));
  const [placeId, setPlaceId] = useState<string | null>(() => initialChoice(places));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const voters = voterCount(plan);
  const ready = (times.length === 0 || timeId !== null) && (places.length === 0 || placeId !== null);
  const deadlinePassed = !plan.can.vote;

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure, t));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const lock = (): Promise<void> =>
    run(async () => {
      onChange(await lockPlan(id, { ...(timeId ? { timeOptionId: timeId } : {}), ...(placeId ? { placeOptionId: placeId } : {}) }));
    });

  const choose = (kind: 'time' | 'place', options: PlanOption[], chosen: string | null, set: (id: string) => void): ReactNode => {
    if (options.length === 0) return null;
    const { leaderId, tie } = kindLeader(options);
    const heading = kind === 'time' ? t('lock.timeHeading') : t('lock.placeHeading');
    return (
      <div className="group">
        <div className="sec">
          <h2 className="sec-title" id={`lock-${kind}`}>
            {heading}
          </h2>
          {tie.length > 0 && <span className="pill pill-warn">{t('lock.tie', { counts: tie.join('–') })}</span>}
        </div>
        <div className="optlist" role="radiogroup" aria-labelledby={`lock-${kind}`} data-id={`lock-${kind}`}>
          {options.map((option) => {
            const isChosen = option.id === chosen;
            const note = option.id === leaderId ? t('lock.leader') : isChosen ? t('lock.chosen') : undefined;
            return <OptionRow key={option.id} option={option} area={plan.area} share={null} role="radio" win={isChosen} note={note} disabled={busy} onClick={() => set(option.id)} />;
          })}
        </div>
      </div>
    );
  };

  const total = plan.groupSize;
  const votersLine =
    total === null ? t('lock.voters', { n: voters }) : voters >= total ? t('lock.votersAll', { n: voters, total }) : t('lock.votersOf', { n: voters, total });

  return (
    <div className="lock-panel" data-id="lock-panel">
      <section className="card people-card" aria-label={votersLine}>
        <p className="row">
          <Icon name="users" />
          <strong>{voters > 0 ? votersLine : t('lock.noVoters')}</strong>
        </p>
        {plan.participants.length > 0 && (
          <ul className="people">
            {plan.participants.map((person) => (
              <PersonChip
                key={person.id}
                name={person.displayName}
                faded={person.rsvp === 'no'}
                note={person.rsvp === 'no' ? t('lock.notGoing') : person.rsvp === 'maybe' ? t('lock.maybe') : undefined}
              />
            ))}
          </ul>
        )}
      </section>
      {deadlinePassed && <p className="alert alert-warn">{t('lock.deadlinePassed')}</p>}
      {choose('time', times, timeId, setTimeId)}
      {choose('place', places, placeId, setPlaceId)}

      {confirm ? (
        <div className="confirm" role="group" aria-label={confirm === 'rotate' ? t('lock.rotate') : t('lock.cancel')} data-id={`confirm-${confirm}`}>
          <p>{confirm === 'rotate' ? t('lock.rotateConfirm') : t('lock.cancelConfirm')}</p>
          <div className="row">
            <button
              type="button"
              className={confirm === 'cancel' ? 'btn btn-text danger' : 'btn btn-text'}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (confirm === 'rotate') {
                    await rotateLink(id);
                    onRotated();
                  } else onChange(await cancelPlan(id));
                })
              }
              data-id="confirm-yes"
            >
              {t('lock.confirmYes')}
            </button>
            <button type="button" className="btn btn-text" onClick={() => setConfirm(null)} data-id="confirm-no">
              {t('lock.confirmNo')}
            </button>
          </div>
        </div>
      ) : (
        <div className="row row-center">
          <a className="btn btn-text" href={`/plans/${encodeURIComponent(id)}`} data-id="lock-share">
            {t('lock.share')}
          </a>
          {plan.can.rotateLink && (
            <button type="button" className="btn btn-text" onClick={() => setConfirm('rotate')} data-id="lock-rotate">
              {t('lock.rotate')}
            </button>
          )}
          {plan.can.cancel && (
            <button type="button" className="btn btn-text danger" onClick={() => setConfirm('cancel')} data-id="lock-cancel">
              {t('lock.cancel')}
            </button>
          )}
        </div>
      )}

      <div className="action-bar">
        <FormError message={error} dataId="lock-error" />
        <button type="button" className="btn btn-primary" aria-busy={busy} disabled={busy || !ready} onClick={() => void lock()} data-id="lock-submit">
          <Icon name="lock" />
          {busy ? t('lock.submitting') : t('lock.submit')}
        </button>
        <p className="help">{ready ? t('lock.help') : t('lock.needChoice')}</p>
      </div>
    </div>
  );
}
