/**
 * One story-image template per activity: the background colour (a tokens.css custom property, read at draw time), a
 * geometric pattern drawn on the canvas, the activity's sticker (apps/web/public/stickers, AI-drawn) and the ink of
 * the title. A plan of another kind gets the default: the app's lime with its logo.
 */
import type { Activity } from '../api/plans-api';

export type StoryPattern = 'dots' | 'stripes' | 'stars' | 'zigzag' | 'confetti' | 'grid' | 'none';

export interface StoryTemplate {
  /** The custom property of tokens.css holding the background colour. */
  bgToken: string;
  pattern: StoryPattern;
  /** The sticker image, or null for the app's logo. */
  sticker: string | null;
  /** The title and pattern ink: dark (black) on light backgrounds, light (white) on dark ones. */
  ink: 'dark' | 'light';
}

const sticker = (name: string): string => `/stickers/${name}.webp`;

export const DEFAULT_TEMPLATE: StoryTemplate = { bgToken: '--c-lock', pattern: 'none', sticker: null, ink: 'dark' };

export const STORY_TEMPLATES: Record<Activity, StoryTemplate> = {
  coffee: { bgToken: '--story-cafe', pattern: 'dots', sticker: sticker('cafe'), ink: 'dark' },
  dinner: { bgToken: '--story-food', pattern: 'stripes', sticker: sticker('food'), ink: 'dark' },
  movie: { bgToken: '--story-movie', pattern: 'stars', sticker: sticker('movie'), ink: 'light' },
  karaoke: { bgToken: '--story-karaoke', pattern: 'stars', sticker: sticker('karaoke'), ink: 'dark' },
  day_trip: { bgToken: '--story-trip', pattern: 'zigzag', sticker: sticker('trip'), ink: 'dark' },
  birthday: { bgToken: '--story-birthday', pattern: 'confetti', sticker: sticker('birthday'), ink: 'dark' },
  lunch: { bgToken: '--story-lunch', pattern: 'grid', sticker: sticker('lunch'), ink: 'dark' },
  party: { bgToken: '--story-party', pattern: 'confetti', sticker: sticker('party'), ink: 'light' },
  team_building: { bgToken: '--story-teambuilding', pattern: 'zigzag', sticker: sticker('teambuilding'), ink: 'dark' },
  meeting: { bgToken: '--story-meeting', pattern: 'grid', sticker: sticker('meeting'), ink: 'dark' },
  other: DEFAULT_TEMPLATE,
};

export function storyTemplate(activity: Activity): StoryTemplate {
  return STORY_TEMPLATES[activity];
}
