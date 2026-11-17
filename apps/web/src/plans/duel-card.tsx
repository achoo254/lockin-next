/** The house rules of a solo game plan, as a card on the plan page and a block of the ticket. */
import type { ReactNode } from 'react';
import type { Duel } from '../api/plans-api';
import { useI18n } from '../i18n/i18n';
import { Icon } from '../ui/icon';

/** The rule lines of a duel in reading order: the preset rules, then the creator's own. */
export function useDuelRuleLines(duel: Duel): string[] {
  const { t } = useI18n();
  return [...duel.rules.map((rule) => t(`duel.rule.${rule}`)), ...duel.customRules];
}

/** "Liên Quân Mobile · Bo3 · Ai phá trụ đầu tiên thắng" with the rules under it and the stake last. */
export function DuelCard({ duel, withAccept = false }: { duel: Duel; withAccept?: boolean }): ReactNode {
  const { t } = useI18n();
  const lines = useDuelRuleLines(duel);
  return (
    <section className="duel-card" aria-label={t('duel.heading')} data-id="duel-card">
      <p className="sec">
        <span className="sec-title">{t('duel.heading')}</span>
        <span className="muted">{t('duel.rulesCount', { n: lines.length })}</span>
      </p>
      <div className="meta">
        <span className="pill">{t(`duel.game.${duel.game}`)}</span>
        <span className="pill">{t(`duel.bestOf.${duel.bestOf}`)}</span>
      </div>
      <p className="duel-win">{t(`duel.win.${duel.winCondition}`)}</p>
      {lines.length > 0 ? (
        <ul className="duel-rules" data-id="duel-rules">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`}>
              <Icon name="check" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t('duel.noRules')}</p>
      )}
      {duel.stake && (
        <p className="duel-stake" data-id="duel-stake">
          {t('duel.stake', { stake: duel.stake })}
        </p>
      )}
      {withAccept && <p className="hint">{t('duel.accept')}</p>}
    </section>
  );
}
