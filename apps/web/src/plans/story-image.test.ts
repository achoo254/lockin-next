import { describe, expect, it } from 'vitest';
import { ACTIVITIES } from '../api/plans-api';
import { type Measure, SCENE_H, SCENE_W, type StoryInput, STORY_HEIGHT, STORY_WIDTH, fitNames, storyLayout, wrapText } from './story-image';
import { DEFAULT_TEMPLATE, STORY_TEMPLATES, storyTemplate } from './story-templates';

const stickerFiles = Object.keys(import.meta.glob('../../public/stickers/*.webp')).map((file) => file.replace('../../public', ''));

/** A stand-in for canvas measureText: every character is 0.55 of the font size wide. */
const measure: Measure = (text, font) => {
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? 16);
  return Array.from(text).length * size * 0.55;
};
const FONT = '700 20px x';

const input = (overrides: Partial<StoryInput> = {}): StoryInput => ({
  appName: 'Lockin',
  template: storyTemplate('coffee'),
  stamp: 'ĐÃ CHỐT',
  footer: 'Chốt kèo trên lockin.hoandat.com',
  title: 'Cà phê thứ Bảy',
  when: 'Thứ Bảy 07/11, 9:00',
  place: 'Quán cà phê B',
  area: 'Quận 3',
  names: ['Minh', 'Linh', 'Tú'],
  nobodyLabel: 'Chưa ai báo tham gia',
  ...overrides,
});

const texts = (shapes: ReturnType<typeof storyLayout>): string[] => shapes.flatMap((shape) => (shape.kind === 'text' ? [shape.text] : []));

describe('story text layout', () => {
  it('wraps by words, cuts a word wider than a line, and ends a cut-short text with …', () => {
    // 11 px per character at 20 px: 10 characters per 110 px line.
    expect(wrapText('Cà phê thứ Bảy', 111, 3, FONT, measure)).toEqual(['Cà phê thứ', 'Bảy']);
    expect(wrapText('Supercalifragilistic', 111, 3, FONT, measure)).toEqual(['Supercalif', 'ragilistic']);
    const long = wrapText('một hai ba bốn năm sáu bảy tám chín mười mười một mười hai', 110, 2, FONT, measure);
    expect(long).toHaveLength(2);
    expect(long[1]?.endsWith('…')).toBe(true);
    for (const line of long) expect(measure(line, FONT)).toBeLessThanOrEqual(110);
  });

  it('lists every name when they fit, and "+N" for the rest when they do not', () => {
    expect(fitNames(['Minh', 'Linh', 'Tú'], 400, 2, FONT, measure)).toEqual(['Minh, Linh, Tú']);
    const many = Array.from({ length: 30 }, (_, i) => `Bạn${i + 1}`);
    const lines = fitNames(many, 200, 2, FONT, measure);
    expect(lines).toHaveLength(2);
    const last = lines[1] ?? '';
    const shown = lines.join(' ').split(',').length - 1;
    expect(last).toMatch(new RegExp(`\\+${30 - shown}$`));
    for (const line of lines) expect(measure(line, FONT)).toBeLessThanOrEqual(200);
  });

  it('keeps a long title to three lines and many names inside the image', () => {
    const shapes = storyLayout(input({ title: 'Kèo cực kỳ dài '.repeat(12), names: Array.from({ length: 60 }, (_, i) => `Người bạn số ${i}`) }), measure);
    const titleLines = shapes.filter((shape) => shape.kind === 'text' && shape.font.includes('112px'));
    expect(titleLines).toHaveLength(3);
    expect(texts(shapes).some((text) => /\+\d+$/.test(text))).toBe(true);
    for (const shape of shapes) {
      if (shape.kind === 'rect' || shape.kind === 'image') {
        const width = shape.kind === 'rect' ? shape.w : shape.size;
        const height = shape.kind === 'rect' ? shape.h : shape.size;
        expect(shape.x + width).toBeLessThanOrEqual(STORY_WIDTH);
        expect(shape.y + height).toBeLessThanOrEqual(STORY_HEIGHT);
      }
    }
  });

  it('draws no emoji or other glyphs a device font may lack: the box icons are paths', () => {
    const shapes = storyLayout(input(), measure);
    for (const text of texts(shapes)) expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(shapes.filter((shape) => shape.kind === 'icon').map((shape) => shape.kind === 'icon' && shape.icon)).toEqual(['clock', 'pin', 'users']);
    expect(texts(shapes)).toContain('Quán cà phê B · Quận 3');
    expect(texts(shapes)).toContain('Minh, Linh, Tú');
  });

  it('draws the activity sticker for a template that has one, the logo for the default', () => {
    const images = (template: StoryInput['template']): string[] =>
      storyLayout(input({ template }), measure).flatMap((shape) => (shape.kind === 'image' ? [shape.src] : []));
    expect(images(storyTemplate('coffee'))).toEqual(['logo', 'sticker']);
    expect(images(DEFAULT_TEMPLATE)).toEqual(['logo', 'logo']);
  });
});

describe('story image with the scene', () => {
  const withScene = (overrides: Partial<StoryInput> = {}): ReturnType<typeof storyLayout> => storyLayout(input({ hasScene: true, ...overrides }), measure);

  it('draws the scene picture framed in the width of the info boxes, in place of the sticker', () => {
    const shapes = withScene();
    const photos = shapes.filter((shape) => shape.kind === 'photo');
    expect(photos).toHaveLength(1);
    const photo = photos[0];
    expect(photo?.kind === 'photo' && [photo.w, photo.h]).toEqual([SCENE_W, SCENE_H]);
    expect(shapes.flatMap((shape) => (shape.kind === 'image' ? [shape.src] : []))).toEqual(['logo']);
  });

  it('keeps the title, the stamp, the boxes with the names, and the footer below the picture', () => {
    const shapes = withScene();
    const photo = shapes.find((shape) => shape.kind === 'photo');
    const bottom = photo?.kind === 'photo' ? photo.y + photo.h : 0;
    const body = shapes.filter((shape) => shape.kind === 'text' && shape.text !== 'Lockin');
    for (const shape of body) expect(shape.kind === 'text' && shape.y).toBeGreaterThan(bottom);
    expect(texts(shapes)).toEqual(expect.arrayContaining(['Cà phê thứ Bảy', 'ĐÃ CHỐT', 'Thứ Bảy 07/11, 9:00', 'Quán cà phê B · Quận 3', 'Minh, Linh, Tú', 'Chốt kèo trên lockin.hoandat.com']));
  });

  it('shortens a long title to two lines so everything still fits under the picture', () => {
    const shapes = withScene({ title: 'Kèo cực kỳ dài '.repeat(12), names: Array.from({ length: 60 }, (_, i) => `Người bạn số ${i}`) });
    expect(shapes.filter((shape) => shape.kind === 'text' && shape.font.includes('112px'))).toHaveLength(2);
    for (const shape of shapes) {
      if (shape.kind === 'rect' || shape.kind === 'photo') {
        expect(shape.x + shape.w).toBeLessThanOrEqual(STORY_WIDTH);
        expect(shape.y + shape.h).toBeLessThanOrEqual(STORY_HEIGHT);
      }
    }
  });

  it('puts who has not voted on a last line of the same box, and keeps the box to three lines', () => {
    const shapes = withScene({ waiting: ['Vy', 'Hùng'], waitingLabel: 'Chưa vote' });
    expect(texts(shapes)).toEqual(expect.arrayContaining(['Minh, Linh, Tú', 'Chưa vote: Vy, Hùng']));
    const crowded = withScene({ names: Array.from({ length: 60 }, (_, i) => `Người bạn số ${i}`), waiting: Array.from({ length: 30 }, (_, i) => `Chờ ${i}`), waitingLabel: 'Chưa vote' });
    for (const shape of crowded) {
      if (shape.kind === 'rect') expect(shape.y + shape.h).toBeLessThanOrEqual(STORY_HEIGHT);
    }
  });

  it('is the old layout, sticker included, when there is no scene', () => {
    const shapes = storyLayout(input(), measure);
    expect(shapes.some((shape) => shape.kind === 'photo')).toBe(false);
    expect(shapes.flatMap((shape) => (shape.kind === 'image' ? [shape.src] : []))).toEqual(['logo', 'sticker']);
  });
});

describe('story templates', () => {
  it('gives every activity a template, each with its own sticker except "other"', () => {
    for (const activity of ACTIVITIES) expect(STORY_TEMPLATES[activity]).toBeDefined();
    const stickers = ACTIVITIES.filter((activity) => activity !== 'other').map((activity) => storyTemplate(activity).sticker);
    expect(new Set(stickers).size).toBe(10);
    for (const sticker of stickers) expect(sticker).toMatch(/^\/stickers\/[a-z]+\.webp$/);
    expect(storyTemplate('other')).toBe(DEFAULT_TEMPLATE);
    // Each sticker is a file of the site (each background token is checked by pnpm check:tokens).
    for (const sticker of stickers) expect(stickerFiles).toContain(sticker);
  });

  it('writes the title in white on the dark templates only', () => {
    const light = ACTIVITIES.filter((activity) => storyTemplate(activity).ink === 'light');
    expect(light.sort()).toEqual(['movie', 'party']);
    expect(storyTemplate('movie').bgToken).toBe('--story-movie');
    expect(storyTemplate('party').bgToken).toBe('--story-party');
  });
});
