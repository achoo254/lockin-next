/** What the scene is told about a plan: the roster, the sign texts, the board labels. No three.js, so the ticket can build it before the 3D chunk loads. */
import type { PlanView } from '../../api/plans-api';
import type { Locale, Translate } from '../../i18n/i18n';
import { lockedOptions, optionText } from '../plan-format';
import { buildRoster } from './scene-model';
import type { SceneConfig } from './scene-controller';

export type SceneContent = Pick<SceneConfig, 'roster' | 'signage' | 'labels' | 'moreLabel'>;

export function sceneContent(plan: PlanView, t: Translate, locale: Locale): SceneContent {
  const { place } = lockedOptions(plan);
  return {
    roster: buildRoster(plan, t, locale),
    signage: { placeName: place ? optionText(place, locale) : plan.title, area: plan.area },
    labels: { timeBoard: t('scene.group.time'), placeBoard: t('scene.group.place') },
    moreLabel: (n) => t('scene.more', { n }),
  };
}
