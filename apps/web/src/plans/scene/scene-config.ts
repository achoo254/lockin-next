/** What the scene is told about a plan: the roster, the sign texts, the board labels. No three.js, so the ticket can build it before the 3D chunk loads. */
import type { PlanView } from '../../api/plans-api';
import type { Locale, Translate } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/messages';
import { lockedOptions, optionText } from '../plan-format';
import { type SceneTheme, buildRoster, sceneTheme } from './scene-model';
import type { SceneConfig } from './scene-controller';

/** The words that read differently in the arena than in a beer hall (a spot instead of a pub, the stands instead of a table). */
const ARENA_WORDS: Partial<Record<MessageKey, MessageKey>> = {
  'scene.label': 'arena.label',
  'scene.canvasLabel': 'arena.canvasLabel',
  'scene.loading': 'arena.loading',
  'scene.failed': 'arena.failed',
  'scene.groupsHeading': 'arena.groupsHeading',
  'scene.group.sit': 'arena.group.sit',
  'scene.group.place': 'arena.group.place',
  'scene.groupDesc.sit': 'arena.groupDesc.sit',
  'scene.say.noPlace': 'arena.say.noPlace',
};

/** The translator of a scene theme: the arena's own words where it has them, the shared ones otherwise. */
export function sceneTranslate(t: Translate, theme: SceneTheme): Translate {
  return theme === 'arena' ? (key, vars) => t(ARENA_WORDS[key] ?? key, vars) : t;
}

export type SceneContent = Pick<SceneConfig, 'theme' | 'roster' | 'signage' | 'labels' | 'moreLabel'>;

export function sceneContent(plan: PlanView, t: Translate, locale: Locale): SceneContent {
  const { place } = lockedOptions(plan);
  const theme = sceneTheme(plan);
  const say = sceneTranslate(t, theme);
  // The arena's banner: the game and rounds, then the place (or the area) of the duel; a meal's sign: the place, then the area.
  const signage =
    theme === 'arena' && plan.duel
      ? { placeName: `${t(`duel.game.${plan.duel.game}`)} · ${t(`duel.bestOf.${plan.duel.bestOf}`)}`, area: place ? optionText(place, locale) : plan.area }
      : { placeName: place ? optionText(place, locale) : plan.title, area: plan.area };
  return {
    theme,
    roster: buildRoster(plan, say, locale),
    signage,
    labels: { timeBoard: t('scene.group.time'), placeBoard: t('scene.group.place') },
    moreLabel: (n) => t('scene.more', { n }),
  };
}
