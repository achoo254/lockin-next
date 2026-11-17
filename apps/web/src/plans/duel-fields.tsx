/**
 * The "Luật kèo" part of the plan form, shown for a solo game plan: the game, the rounds, how a round is won, the
 * house rules as chips to tick (the 1v1 classics are on from the start), the creator's own rule lines, a friendly stake.
 */
import { type ReactNode, useState } from 'react';
import { BEST_OF, DEFAULT_DUEL_RULES, DUEL_RULES, type Duel, type DuelRule, GAMES, MAX_CUSTOM_RULES, MAX_CUSTOM_RULE_LENGTH, MAX_STAKE_LENGTH, WIN_CONDITIONS } from '../../../server/src/plans/duel';
import { useI18n } from '../i18n/i18n';
import { Icon } from '../ui/icon';

/** The duel as the form holds it: the stake is plain text, empty for none. */
export interface DuelForm extends Omit<Duel, 'stake'> {
  stake: string;
}

export function initialDuel(): DuelForm {
  return { game: 'lien_quan', bestOf: 1, winCondition: 'first_blood', rules: [...DEFAULT_DUEL_RULES], customRules: [], stake: '' };
}

/** The API's duel of the form: stake trimmed, empty for none. */
export function duelInput(form: DuelForm): Duel {
  return { ...form, stake: form.stake.trim() || null };
}

interface DuelFieldsProps {
  duel: DuelForm;
  onChange(duel: DuelForm): void;
}

export function DuelFields({ duel, onChange }: DuelFieldsProps): ReactNode {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const set = (patch: Partial<DuelForm>): void => onChange({ ...duel, ...patch });
  const toggleRule = (rule: DuelRule): void => set({ rules: duel.rules.includes(rule) ? duel.rules.filter((other) => other !== rule) : DUEL_RULES.filter((other) => other === rule || duel.rules.includes(other)) });

  function addCustom(): void {
    const line = draft.trim();
    if (!line || duel.customRules.length >= MAX_CUSTOM_RULES || duel.customRules.some((other) => other.toLowerCase() === line.toLowerCase())) return;
    set({ customRules: [...duel.customRules, line] });
    setDraft('');
  }

  return (
    <fieldset className="group" data-id="duel-fields">
      <legend className="sec">
        <span className="sec-title">{t('duel.heading')}</span>
        <span className="muted">{t('duel.rulesCount', { n: duel.rules.length + duel.customRules.length })}</span>
      </legend>

      <p className="eyebrow">{t('duel.form.game')}</p>
      <div className="chips" role="group" aria-label={t('duel.form.game')} data-id="duel-games">
        {GAMES.map((game) => (
          <button key={game} type="button" className="chip" aria-pressed={duel.game === game} onClick={() => set({ game })} data-id={`duel-game-${game}`}>
            {t(`duel.game.${game}`)}
          </button>
        ))}
      </div>

      <p className="eyebrow">{t('duel.form.bestOf')}</p>
      <div className="chips" role="group" aria-label={t('duel.form.bestOf')} data-id="duel-best-of">
        {BEST_OF.map((n) => (
          <button key={n} type="button" className="chip" aria-pressed={duel.bestOf === n} onClick={() => set({ bestOf: n })} data-id={`duel-best-of-${n}`}>
            {t(`duel.bestOf.${n}`)}
          </button>
        ))}
      </div>

      <p className="eyebrow">{t('duel.form.win')}</p>
      <div className="chips chips-wrap" role="group" aria-label={t('duel.form.win')} data-id="duel-win">
        {WIN_CONDITIONS.map((win) => (
          <button key={win} type="button" className="chip" aria-pressed={duel.winCondition === win} onClick={() => set({ winCondition: win })} data-id={`duel-win-${win}`}>
            {t(`duel.win.${win}`)}
          </button>
        ))}
      </div>

      <p className="eyebrow">{t('duel.form.rules')}</p>
      <p className="muted">{t('duel.form.rulesHint')}</p>
      <div className="chips chips-wrap" role="group" aria-label={t('duel.form.rules')} data-id="duel-rules-chips">
        {DUEL_RULES.map((rule) => (
          <button key={rule} type="button" className="chip" aria-pressed={duel.rules.includes(rule)} onClick={() => toggleRule(rule)} data-id={`duel-rule-${rule}`}>
            {t(`duel.rule.${rule}`)}
          </button>
        ))}
      </div>

      <p className="eyebrow">{t('duel.form.custom')}</p>
      {duel.customRules.length > 0 && (
        <ol className="optlist rows" data-id="duel-custom-rows">
          {duel.customRules.map((line, index) => (
            <li key={line} className="opt opt-edit">
              <Icon name="check" className="accent" />
              <span className="in-grow">{line}</span>
              <button type="button" className="icon-btn" aria-label={t('duel.form.customRemove', { n: index + 1 })} onClick={() => set({ customRules: duel.customRules.filter((other) => other !== line) })}>
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ol>
      )}
      {duel.customRules.length < MAX_CUSTOM_RULES && (
        <div className="row">
          <input
            className="in in-sm in-grow"
            value={draft}
            maxLength={MAX_CUSTOM_RULE_LENGTH}
            aria-label={t('duel.form.custom')}
            placeholder={t('duel.form.customPlaceholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
            data-id="duel-custom-input"
          />
          <button type="button" className="btn btn-ghost btn-sm" disabled={draft.trim() === ''} onClick={addCustom} data-id="duel-custom-add">
            <Icon name="plus" />
            {t('duel.form.customAdd')}
          </button>
        </div>
      )}

      <label className="field">
        <span>
          {t('duel.form.stake')} <span className="muted-inline">({t('duel.form.stakeHint')})</span>
        </span>
        <input className="in" value={duel.stake} maxLength={MAX_STAKE_LENGTH} placeholder={t('duel.form.stakePlaceholder')} onChange={(e) => set({ stake: e.target.value })} data-id="duel-stake-input" />
      </label>
    </fieldset>
  );
}
