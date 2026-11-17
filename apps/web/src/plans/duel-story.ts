/** The "Luật kèo" lines of a solo game plan's story image: what the plan says, cut to the room the image has. */
import type { Duel } from '../api/plans-api';
import type { Translate } from '../i18n/i18n';

/** The box has this many lines at most: the header, how a round is won, then the rules and the stake. */
export const STORY_RULE_LINES = 6;

/**
 * The header ("Liên Minh Huyền Thoại · Bo3"), how a round is won, the stake when there is one, and as many rules as
 * the rest allows; when some do not fit, the last rule line says how many were left out.
 */
export function duelStoryLines(duel: Duel, t: Translate): string[] {
  const header = [t(`duel.game.${duel.game}`), t(`duel.bestOf.${duel.bestOf}`).split(' · ')[0] ?? ''].filter(Boolean).join(' · ');
  const win = t(`duel.win.${duel.winCondition}`);
  const stake = duel.stake ? [t('duel.stake', { stake: duel.stake })] : [];
  const rules = [...duel.rules.map((rule) => t(`duel.rule.${rule}`)), ...duel.customRules];
  const room = STORY_RULE_LINES - 2 - stake.length;
  const shown = rules.length <= room ? rules : [...rules.slice(0, room - 1), t('story.rulesMore', { n: rules.length - (room - 1) })];
  return [header, win, ...shown, ...stake];
}
