/**
 * Making a plan on one screen (mockup screen 02), mostly by tapping: a kind (fills the title), quick times (today
 * noon, tonight, this Saturday and Sunday at 19:00, or any other), places as free text or a pasted maps link, the
 * vote deadline (3 hours, tonight 22:00, 24 hours by default, or any other), and optional area, budget and group size.
 * Every time is Vietnam time. buildCreateInput() turns the form into the API body or the first problem.
 */
import { type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode, useId, useState } from 'react';
import { ACTIVITIES, type Activity, type CreatePlanInput, createPlan } from '../api/plans-api';
import { type Translate, useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { isGoogleMapsLink, placeNameFromMapsLink } from '../../../server/src/plans/map-link';
import { Icon } from '../ui/icon';
import { errorMessage } from './error-message';
import { FormError } from './plan-parts';
import { comingWeekdayAt, formatLeft, formatVnDateTime, vnDayAt, vnInputs, vnInputsToDate } from './vn-time';

const HOUR = 60 * 60 * 1000;
const MAX_DEADLINE_MS = 60 * 24 * HOUR;
const MAX_PER_KIND = 10;
const MAX_BUDGET = 100_000_000;

/** The kinds with a chip, in chip order (friends first, then work); `other` is no chip picked. */
export const ACTIVITY_CHIPS = ACTIVITIES.filter((activity): activity is Exclude<Activity, 'other'> => activity !== 'other');

export type QuickTime = 'noon' | 'tonight' | 'sat' | 'sun';
export const QUICK_TIMES: readonly QuickTime[] = ['noon', 'tonight', 'sat', 'sun'];
const QUICK_LABEL: Record<QuickTime, MessageKey> = { noon: 'form.quickNoon', tonight: 'form.quickTonight', sat: 'form.quickSat', sun: 'form.quickSun' };

export type DeadlinePreset = '3h' | 'tonight' | '24h' | 'custom';
export const DEADLINE_PRESETS: readonly DeadlinePreset[] = ['3h', 'tonight', '24h', 'custom'];
const DEADLINE_LABEL: Record<DeadlinePreset, MessageKey> = { '3h': 'form.deadline3h', tonight: 'form.deadlineTonight', '24h': 'form.deadline24h', custom: 'form.deadlineOther' };

export interface TimeRow {
  key: string;
  date: string;
  time: string;
  /** The quick chip that added it (its chip shows pressed until the row is edited or removed). */
  quick: QuickTime | null;
}

export interface PlaceRow {
  key: string;
  label: string;
  /** A pasted Google Maps link, kept beside the editable name. */
  mapUrl: string | null;
}

/**
 * What a whole place box holds once pasted, left or entered: a Google Maps link is attached to the place (its name
 * pre-filled from a place link; a short link says nothing, so the name stays to be typed); anything else is the name.
 * Typing never calls this: a link typed key by key is a valid link long before it is complete.
 */
export function placeInput(row: PlaceRow, value: string): PlaceRow {
  if (isGoogleMapsLink(value)) return { ...row, mapUrl: value.trim(), label: placeNameFromMapsLink(value) ?? '' };
  return { ...row, label: value };
}

export interface CreateForm {
  activity: Activity;
  title: string;
  area: string;
  /** Digits only. */
  budget: string;
  /** Digits only. */
  groupSize: string;
  name: string;
  times: TimeRow[];
  places: PlaceRow[];
  deadline: DeadlinePreset;
  deadlineDate: string;
  deadlineTime: string;
}

/** When a quick time falls; null when it has already passed today. */
export function quickTimeAt(quick: QuickTime, now: Date): Date | null {
  const at =
    quick === 'noon' ? vnDayAt(now, 0, '12:00') : quick === 'tonight' ? vnDayAt(now, 0, '19:00') : comingWeekdayAt(now, quick === 'sat' ? 6 : 0, '19:00');
  return at && at.getTime() > now.getTime() ? at : null;
}

/** The vote deadline a preset gives (custom: the date and time typed); null when it cannot be had. */
export function deadlineAt(form: Pick<CreateForm, 'deadline' | 'deadlineDate' | 'deadlineTime'>, now: Date): Date | null {
  switch (form.deadline) {
    case '3h':
      return new Date(now.getTime() + 3 * HOUR);
    case '24h':
      return new Date(now.getTime() + 24 * HOUR);
    case 'tonight': {
      const at = vnDayAt(now, 0, '22:00');
      return at && at.getTime() > now.getTime() ? at : null;
    }
    case 'custom':
      return vnInputsToDate({ date: form.deadlineDate, time: form.deadlineTime });
  }
}

let rowCount = 0;
const rowKey = (): string => `row-${++rowCount}`;

export function quickRow(quick: QuickTime, now: Date): TimeRow | null {
  const at = quickTimeAt(quick, now);
  return at ? { key: rowKey(), ...vnInputs(at), quick } : null;
}

/** A fresh form: coffee, this weekend's evenings, one empty place, 24 hours to vote. */
export function initialForm(now: Date, name: string, t: Translate): CreateForm {
  const times = (['sat', 'sun'] as const).flatMap((quick) => quickRow(quick, now) ?? []);
  const later = vnInputs(new Date(now.getTime() + 24 * HOUR));
  return {
    activity: 'coffee',
    title: t('template.coffee'),
    area: '',
    budget: '',
    groupSize: '',
    name: name.slice(0, 40),
    times,
    places: [{ key: rowKey(), label: '', mapUrl: null }],
    deadline: '24h',
    deadlineDate: later.date,
    deadlineTime: later.time,
  };
}

export type BuildResult = { ok: true; input: CreatePlanInput } | { ok: false; error: MessageKey; n?: number };

/** The API body of the form, or the first thing to fix. `nameRequired`: signed out, the creator's name is a must. */
export function buildCreateInput(form: CreateForm, now: Date, nameRequired = false): BuildResult {
  const title = form.title.trim();
  if (!title) return { ok: false, error: 'form.error.title' };
  const name = form.name.trim();
  if (nameRequired && !name) return { ok: false, error: 'form.error.name' };
  const options: CreatePlanInput['options'] = [];
  for (const [index, row] of form.times.entries()) {
    if (!row.date && !row.time) continue;
    const at = vnInputsToDate(row);
    if (!at) return { ok: false, error: 'form.error.timeIncomplete', n: index + 1 };
    if (at.getTime() <= now.getTime()) return { ok: false, error: 'form.error.timePast', n: index + 1 };
    options.push({ kind: 'time', startsAt: at.toISOString() });
  }
  for (const [index, row] of form.places.entries()) {
    const label = row.label.trim();
    if (!label && row.mapUrl) return { ok: false, error: 'form.error.placeLabel', n: index + 1 };
    if (label) options.push({ kind: 'place', label, ...(row.mapUrl ? { mapUrl: row.mapUrl } : {}) });
  }
  if (options.length === 0) return { ok: false, error: 'form.error.noOption' };
  let budgetPerPerson: number | undefined;
  if (form.budget) {
    budgetPerPerson = Number(form.budget);
    if (!Number.isInteger(budgetPerPerson) || budgetPerPerson > MAX_BUDGET) return { ok: false, error: 'form.error.budget' };
  }
  let groupSize: number | undefined;
  if (form.groupSize) {
    groupSize = Number(form.groupSize);
    if (!Number.isInteger(groupSize) || groupSize < 2 || groupSize > 50) return { ok: false, error: 'form.error.groupSize' };
  }
  const deadline = deadlineAt(form, now);
  if (!deadline) return { ok: false, error: form.deadline === 'custom' ? 'form.error.deadlineIncomplete' : 'form.error.deadline' };
  if (deadline.getTime() <= now.getTime() || deadline.getTime() > now.getTime() + MAX_DEADLINE_MS) return { ok: false, error: 'form.error.deadline' };
  const area = form.area.trim();
  return {
    ok: true,
    input: {
      title,
      activity: form.activity,
      ...(area ? { area } : {}),
      ...(budgetPerPerson !== undefined ? { budgetPerPerson } : {}),
      ...(groupSize !== undefined ? { groupSize } : {}),
      voteDeadline: deadline.toISOString(),
      options,
      ...(name ? { creatorDisplayName: name } : {}),
    },
  };
}

const digits = (value: string, max: number): string => value.replace(/\D/g, '').slice(0, max);

interface PlanFormProps {
  /** The account's name, pre-filled as the creator's name in the plan. */
  defaultName: string;
  /** Signed out: the creator's name must be given (it is how the group knows who made the plan). */
  nameRequired?: boolean;
  /** The clock (tests pass a fixed one). */
  now?: () => Date;
  /** After the plan is made (the page goes to its share screen). */
  onCreated(planId: string): void;
}

export function PlanForm({ defaultName, nameRequired = false, now = () => new Date(), onCreated }: PlanFormProps): ReactNode {
  const { t, locale } = useI18n();
  const ids = useId();
  const [form, setForm] = useState<CreateForm>(() => initialForm(now(), defaultName, t));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<CreateForm>): void => setForm((current) => ({ ...current, ...patch }));
  const clock = now();

  function pickActivity(activity: Exclude<Activity, 'other'>): void {
    setForm((current) => {
      const templates = ACTIVITY_CHIPS.map((kind) => t(`template.${kind}`));
      const keepsTitle = current.title.trim() !== '' && !templates.includes(current.title.trim());
      // Tapping the picked chip again leaves "other".
      const next: Activity = current.activity === activity ? 'other' : activity;
      return { ...current, activity: next, title: keepsTitle || next === 'other' ? current.title : t(`template.${activity}`) };
    });
  }

  function toggleQuick(quick: QuickTime): void {
    setForm((current) => {
      if (current.times.some((row) => row.quick === quick)) return { ...current, times: current.times.filter((row) => row.quick !== quick) };
      const row = quickRow(quick, now());
      return row && current.times.length < MAX_PER_KIND ? { ...current, times: [...current.times, row] } : current;
    });
  }

  const setPlace = (key: string, change: (row: PlaceRow) => PlaceRow): void =>
    setForm((current) => ({ ...current, places: current.places.map((row) => (row.key === key ? change(row) : row)) }));

  /** A paste that leaves a whole map link in the box attaches it at once (the name taken from the link). */
  function pastePlace(row: PlaceRow, event: ClipboardEvent<HTMLInputElement>): void {
    const box = event.currentTarget;
    const pasted = event.clipboardData.getData('text');
    const value = box.value.slice(0, box.selectionStart ?? box.value.length) + pasted + box.value.slice(box.selectionEnd ?? box.value.length);
    if (!isGoogleMapsLink(value)) return;
    event.preventDefault();
    setPlace(row.key, (current) => placeInput(current, value));
  }

  /** Leaving the box, or Enter in it, attaches a typed link once the whole box is one; true when it did. */
  function settlePlace(row: PlaceRow): boolean {
    if (!isGoogleMapsLink(row.label)) return false;
    setPlace(row.key, (current) => placeInput(current, current.label));
    return true;
  }

  function placeKey(row: PlaceRow, event: KeyboardEvent<HTMLInputElement>): void {
    // Enter on a typed link attaches it instead of sending the form.
    if (event.key === 'Enter' && settlePlace(row)) event.preventDefault();
  }

  const setTime = (key: string, patch: Partial<TimeRow>): void =>
    setForm((current) => ({ ...current, times: current.times.map((row) => (row.key === key ? { ...row, ...patch, quick: null } : row)) }));

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const built = buildCreateInput(form, now(), nameRequired);
    if (!built.ok) {
      setError(t(built.error, { n: built.n ?? 0 }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { plan } = await createPlan(built.input);
      onCreated(plan.id ?? '');
    } catch (failure) {
      setError(errorMessage(failure, t));
      setBusy(false);
    }
  }

  const deadline = deadlineAt(form, clock);
  const left = deadline ? formatLeft(deadline, clock, t) : null;
  const tomorrow = vnInputs(new Date(clock.getTime() + 24 * HOUR)).date;

  return (
    <form className="plan-form" onSubmit={(event) => void submit(event)} noValidate data-id="plan-form">
      <div className="chips" role="group" aria-label={t('form.kinds')} data-id="activity-chips">
        {ACTIVITY_CHIPS.map((activity) => (
          <button key={activity} type="button" className="chip" aria-pressed={form.activity === activity} onClick={() => pickActivity(activity)} data-id={`activity-${activity}`}>
            {t(`activity.${activity}`)}
          </button>
        ))}
      </div>

      <label className="field">
        {t('form.title')}
        <input className="in" value={form.title} maxLength={80} placeholder={t('form.titlePlaceholder')} onChange={(e) => update({ title: e.target.value })} data-id="form-title" />
      </label>
      <div className="field-row">
        <label className="field">
          {t('form.area')}
          <input className="in" value={form.area} maxLength={80} onChange={(e) => update({ area: e.target.value })} data-id="form-area" />
        </label>
        <label className="field">
          {t('form.budget')}
          <span className="in-suffix">
            <input
              className="in"
              inputMode="numeric"
              value={form.budget ? Number(form.budget).toLocaleString('vi-VN') : ''}
              aria-describedby={`${ids}-budget`}
              onChange={(e) => update({ budget: digits(e.target.value, 9) })}
              data-id="form-budget"
            />
            <span id={`${ids}-budget`} className="suffix">
              đ
            </span>
          </span>
        </label>
      </div>

      <fieldset className="group">
        <legend className="sec">
          <span className="sec-title">{t('form.times')}</span>
          <span className="muted">{t('form.count', { n: form.times.length })}</span>
        </legend>
        <div className="chips" role="group" aria-label={t('form.times')} data-id="quick-times">
          {QUICK_TIMES.map((quick) => (
            <button
              key={quick}
              type="button"
              className="chip"
              aria-pressed={form.times.some((row) => row.quick === quick)}
              disabled={quickTimeAt(quick, clock) === null}
              onClick={() => toggleQuick(quick)}
              data-id={`quick-${quick}`}
            >
              {t(QUICK_LABEL[quick])}
            </button>
          ))}
        </div>
        <ol className="optlist rows" data-id="time-rows">
          {form.times.map((row, index) => (
            <li key={row.key} className="opt opt-edit">
              <Icon name="clock" className="accent" />
              <input
                className="in in-sm"
                type="date"
                aria-label={`${t('form.date')} ${index + 1}`}
                value={row.date}
                onChange={(e) => setTime(row.key, { date: e.target.value })}
                data-id={`time-date-${index}`}
              />
              <input
                className="in in-sm"
                type="time"
                aria-label={`${t('form.time')} ${index + 1}`}
                value={row.time}
                onChange={(e) => setTime(row.key, { time: e.target.value })}
                data-id={`time-time-${index}`}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={t('form.removeTime', { n: index + 1 })}
                onClick={() => update({ times: form.times.filter((other) => other.key !== row.key) })}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ol>
        {form.times.length < MAX_PER_KIND && (
          <button
            type="button"
            className="addrow"
            onClick={() => update({ times: [...form.times, { key: rowKey(), date: tomorrow, time: '', quick: null }] })}
            data-id="add-time"
          >
            <Icon name="plus" />
            {t('form.quickOther')}
          </button>
        )}
      </fieldset>

      <fieldset className="group">
        <legend className="sec">
          <span className="sec-title">{t('form.places')}</span>
          <span className="muted">{t('form.count', { n: form.places.filter((row) => row.label.trim()).length })}</span>
        </legend>
        <ol className="optlist rows" data-id="place-rows">
          {form.places.map((row, index) => (
            <li key={row.key} className={row.mapUrl ? 'opt opt-edit opt-mapped' : 'opt opt-edit'}>
              <Icon name="pin" className="accent" />
              <input
                className="in in-sm in-grow"
                value={row.label}
                maxLength={300}
                aria-label={`${t('form.place')} ${index + 1}`}
                placeholder={t('form.placeHint')}
                onChange={(e) => setPlace(row.key, (current) => ({ ...current, label: e.target.value }))}
                onPaste={(e) => pastePlace(row, e)}
                onBlur={() => settlePlace(row)}
                onKeyDown={(e) => placeKey(row, e)}
                data-id={`place-${index}`}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={t('form.removePlace', { n: index + 1 })}
                onClick={() => update({ places: form.places.filter((other) => other.key !== row.key) })}
              >
                <Icon name="close" />
              </button>
              {row.mapUrl && (
                <span className="map-attached" data-id={`place-map-${index}`}>
                  <span>
                    {t('form.mapAttached')}
                    {!row.label.trim() && <span className="hint"> · {t('form.mapNeedsLabel')}</span>}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('form.mapRemove', { n: index + 1 })}
                    onClick={() => update({ places: form.places.map((other) => (other.key === row.key ? { ...other, mapUrl: null } : other)) })}
                  >
                    <Icon name="linkOff" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
        {form.places.length < MAX_PER_KIND && (
          <button type="button" className="addrow" onClick={() => update({ places: [...form.places, { key: rowKey(), label: '', mapUrl: null }] })} data-id="add-place">
            <Icon name="plus" />
            {t('form.addPlace')}
          </button>
        )}
      </fieldset>

      <fieldset className="group">
        <legend className="sec">
          <span className="sec-title">{t('form.deadline')}</span>
        </legend>
        <div className="chips" role="group" aria-label={t('form.deadline')} data-id="deadline-chips">
          {DEADLINE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="chip"
              aria-pressed={form.deadline === preset}
              disabled={preset === 'tonight' && deadlineAt({ ...form, deadline: 'tonight' }, clock) === null}
              onClick={() => update({ deadline: preset })}
              data-id={`deadline-${preset}`}
            >
              {t(DEADLINE_LABEL[preset])}
            </button>
          ))}
        </div>
        {form.deadline === 'custom' && (
          <div className="field-row">
            <label className="field">
              {t('form.date')}
              <input className="in" type="date" value={form.deadlineDate} onChange={(e) => update({ deadlineDate: e.target.value })} data-id="deadline-date" />
            </label>
            <label className="field">
              {t('form.time')}
              <input className="in" type="time" value={form.deadlineTime} onChange={(e) => update({ deadlineTime: e.target.value })} data-id="deadline-time" />
            </label>
          </div>
        )}
        <p className="muted" data-id="deadline-hint">
          {t('form.deadlineHint', { left: deadline && left ? t('time.inFuture', { left, when: formatVnDateTime(deadline, locale) }) : '' })}
        </p>
      </fieldset>

      <div className="field-row">
        <label className="field">
          <span>
            {t('form.groupSize')} <span className="muted-inline">({t('form.groupSizeHint')})</span>
          </span>
          <input className="in" inputMode="numeric" value={form.groupSize} onChange={(e) => update({ groupSize: digits(e.target.value, 2) })} data-id="form-group-size" />
        </label>
      </div>
      <label className="field">
        {t('form.name')}
        <input
          className="in"
          value={form.name}
          maxLength={40}
          autoComplete="nickname"
          required={nameRequired}
          aria-describedby={`${ids}-name`}
          onChange={(e) => update({ name: e.target.value })}
          data-id="form-name"
        />
        <span id={`${ids}-name`} className="hint">
          {nameRequired ? t('form.nameHintRequired') : t('form.nameHint')}
        </span>
      </label>

      <div className="action-bar">
        <FormError message={error} dataId="form-error" />
        <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={busy} data-id="form-submit">
          {busy ? t('form.submitting') : t('form.submit')}
        </button>
        <p className="help">{t('form.tz')}</p>
      </div>
    </form>
  );
}
