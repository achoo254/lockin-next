/**
 * The guest's side of the plan page (mockup screen 04): name once, pick any number of times and places, say whether
 * one joins, "Gửi vote". No sign-in ever: the server knows the browser by its guest cookie. With `mode="rsvp"` (voting
 * closed or the plan locked in) only the name and the going switch remain.
 */
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { type PlanView, type Rsvp, joinPlan, sendRsvp, sendVotes } from '../api/plans-api';
import { useI18n } from '../i18n/i18n';
import { errorMessage } from './error-message';
import { nameKey } from '../../../server/src/plans/member-names';
import { membersNotJoined, optionsOf } from './plan-format';
import { FormError, OptionRow, RsvpSwitch } from './plan-parts';

const MAX_NAME = 40;

const sameSet = (a: readonly string[], b: ReadonlySet<string>): boolean => a.length === b.size && a.every((id) => b.has(id));

interface VoteBoardProps {
  plan: PlanView;
  token: string;
  mode: 'vote' | 'rsvp';
  onChange(plan: PlanView): void;
  /** After a successful send (the page shows the nudge and the invite). */
  onSent(): void;
}

export function VoteBoard({ plan, token, mode, onChange, onSent }: VoteBoardProps): ReactNode {
  const { t } = useI18n();
  const nameId = useId();
  const me = plan.participants.find((person) => person.id === plan.viewer.participantId) ?? null;
  const [name, setName] = useState(me?.displayName ?? '');
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(me?.optionIds ?? []));
  const [rsvp, setRsvp] = useState<Rsvp | null>(me?.rsvp ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const voting = mode === 'vote' && plan.can.vote;
  const people = Math.max(1, plan.participants.length);
  // The expected names nobody has taken yet: a tap fills the name so it matches the creator's list.
  const free = membersNotJoined(plan);

  function toggle(id: string): void {
    setSent(false);
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const displayName = name.trim();
    if (!displayName) {
      setError(t('plan.error.name'));
      return;
    }
    if (!me && picked.size === 0 && rsvp === null) {
      setError(t('plan.error.empty'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let next = plan;
      if (!me || me.displayName !== displayName) next = await joinPlan(token, displayName);
      if (voting && !sameSet(me?.optionIds ?? [], picked)) next = await sendVotes(token, [...picked]);
      if (rsvp !== null && rsvp !== me?.rsvp) next = await sendRsvp(token, rsvp);
      onChange(next);
      setSent(true);
      onSent();
    } catch (failure) {
      setError(errorMessage(failure, t));
    } finally {
      setBusy(false);
    }
  }

  const section = (kind: 'time' | 'place', heading: string, hint?: string): ReactNode => {
    const options = optionsOf(plan, kind);
    if (options.length === 0) return null;
    return (
      <fieldset className="group" disabled={!voting || busy}>
        <legend className="sec">
          <span className="sec-title">{heading}</span>
          {hint && voting && <span className="muted">{hint}</span>}
        </legend>
        <div className="optlist">
          {options.map((option) => (
            <OptionRow
              key={option.id}
              option={option}
              area={plan.area}
              share={option.votes / people}
              pressed={picked.has(option.id)}
              onClick={voting ? () => toggle(option.id) : undefined}
            />
          ))}
        </div>
      </fieldset>
    );
  };

  return (
    <form className="vote-board" onSubmit={(event) => void submit(event)} noValidate data-id="vote-board">
      <label className="field" htmlFor={nameId}>
        {t('plan.yourName')}
        <input
          id={nameId}
          className="in"
          value={name}
          maxLength={MAX_NAME}
          autoComplete="nickname"
          onChange={(event) => {
            setName(event.target.value);
            setSent(false);
          }}
          data-id="guest-name"
        />
      </label>
      {!me && free.length > 0 && (
        <div className="chips chips-wrap" role="group" aria-label={t('plan.pickName')} data-id="guest-name-picks">
          {free.map((option) => (
            <button
              key={option}
              type="button"
              className="chip"
              aria-pressed={nameKey(name) === nameKey(option)}
              onClick={() => {
                setName(option);
                setSent(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {mode === 'vote' && section('time', t('plan.timesHeading'), t('plan.multi'))}
      {mode === 'vote' && section('place', t('plan.placesHeading'))}
      {plan.can.rsvp && (
        <div className="group">
          <p className="sec">
            <span className="sec-title">{t('plan.rsvpHeading')}</span>
          </p>
          <RsvpSwitch
            value={rsvp}
            disabled={busy}
            onChange={(next) => {
              setRsvp(next);
              setSent(false);
            }}
          />
        </div>
      )}
      <div className="action-bar">
        <FormError message={error} dataId="vote-error" />
        {sent && (
          <p className="alert alert-ok" role="status" data-id="vote-sent">
            {t('plan.sent')}
          </p>
        )}
        <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={busy} data-id="vote-submit">
          {busy ? t('plan.submitting') : mode === 'vote' ? t('plan.submit') : t('plan.submitRsvp')}
        </button>
        <p className="help">{t('plan.help')}</p>
      </div>
    </form>
  );
}
