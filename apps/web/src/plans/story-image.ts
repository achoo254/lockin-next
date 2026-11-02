/**
 * "Save story image": the locked-in plan as a 1080 × 1920 PNG drawn with Canvas 2D in the browser (mockup screen
 * 07), in the template of its activity (story-templates.ts): background colour and pattern, the activity's sticker
 * large near the top, the title, a tilted coral stamp, white info boxes with black outlines and hard shadows, and the
 * app's host. No emoji or other glyph is drawn (device fonts differ): the box icons are vector paths. The names of the
 * people going are on it: the person saving the image chose to share it.
 *
 * storyLayout() is pure (it measures text through a function), so the wrapping and the "+N" are unit-tested;
 * drawStory() replays its shapes on a canvas.
 */
import type { StoryPattern, StoryTemplate } from './story-templates';

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

/** The colours a story is drawn in: tokens.css values read from the page (the canvas cannot read CSS variables). */
export interface StoryColours {
  /** The template's background. */
  bg: string;
  /** The template's title and pattern ink. */
  titleInk: string;
  ink: string;
  paper: string;
  coral: string;
}

export interface StoryInput {
  appName: string;
  template: StoryTemplate;
  stamp: string;
  /** "Chốt kèo trên lockin.hoandat.com". */
  footer: string;
  title: string;
  when: string | null;
  place: string | null;
  area: string | null;
  names: string[];
  nobodyLabel: string;
}

/** Width of `text` in `font` (canvas measureText in the browser). */
export type Measure = (text: string, font: string) => number;

export type StoryIcon = 'clock' | 'pin' | 'users';

export type StoryShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number; fill: keyof StoryColours; stroke?: number; shadow?: number; rotate?: number }
  | { kind: 'text'; text: string; x: number; y: number; font: string; fill: keyof StoryColours; align?: 'left' | 'center'; rotate?: number; pivot?: [number, number] }
  | { kind: 'pattern'; pattern: StoryPattern }
  | { kind: 'image'; src: 'logo' | 'sticker'; x: number; y: number; size: number; framed: boolean }
  | { kind: 'icon'; icon: StoryIcon; x: number; y: number; size: number };

export const FONT_DISPLAY = '"Bricolage Grotesque", "Be Vietnam Pro", sans-serif';
export const FONT_BODY = '"Be Vietnam Pro", sans-serif';
const font = (weight: number, size: number, family: string): string => `${weight} ${size}px ${family}`;

const ELLIPSIS = '…';

/**
 * `text` in lines of at most `maxWidth`, at most `maxLines`; the last line ends in "…" when text is left over. A word
 * longer than a line is cut by characters.
 */
export function wrapText(text: string, maxWidth: number, maxLines: number, fontSpec: string, measure: Measure): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  const fits = (value: string): boolean => measure(value, fontSpec) <= maxWidth;
  const pushWord = (word: string): void => {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      return;
    }
    if (line) lines.push(line);
    line = '';
    // A word wider than the line: cut it into pieces that fit.
    let rest = word;
    while (!fits(rest)) {
      let cut = rest.length - 1;
      while (cut > 1 && !fits(rest.slice(0, cut))) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  };
  for (const word of words) pushWord(word);
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1] ?? ''}${ELLIPSIS}`;
  while (last.length > 1 && !fits(last)) last = `${last.slice(0, -2)}${ELLIPSIS}`;
  kept[maxLines - 1] = last;
  return kept;
}

/**
 * The names of the people going as comma-separated lines of at most `maxWidth`, at most `maxLines`. When they do
 * not all fit, the last line ends in "+N" for the names left out. A name too long for a line is shortened with "…".
 */
export function fitNames(names: string[], maxWidth: number, maxLines: number, fontSpec: string, measure: Measure): string[] {
  const fits = (value: string): boolean => measure(value, fontSpec) <= maxWidth;
  const shorten = (name: string): string => {
    let label = name;
    while (label.length > 1 && !fits(`${label}, +99`)) label = `${label.slice(0, -2)}${ELLIPSIS}`;
    return label;
  };
  const labels = names.map(shorten);
  const lay = (count: number): string[] | null => {
    const items = labels.slice(0, count).map((label, index) => (index < count - 1 || count < labels.length ? `${label},` : label));
    if (count < labels.length) items.push(`+${labels.length - count}`);
    const lines: string[] = [];
    let line = '';
    for (const item of items) {
      const candidate = line ? `${line} ${item}` : item;
      if (line && !fits(candidate)) {
        lines.push(line);
        line = item;
      } else line = candidate;
    }
    if (line) lines.push(line);
    return lines.length <= maxLines ? lines : null;
  };
  for (let count = labels.length; count >= 0; count--) {
    const lines = lay(count);
    if (lines) return lines;
  }
  return [`+${labels.length}`];
}

const MARGIN = 90;
const INNER_W = STORY_WIDTH - 2 * MARGIN;
const TITLE_FONT = font(800, 112, FONT_DISPLAY);
const LINE_FONT = font(700, 48, FONT_BODY);
const LINE_PAD = 34;
const LINE_STEP = 62;
const ICON = 52;
const ICON_GAP = 22;
const STICKER = 460;

/** Every shape of the story image, back to front. */
export function storyLayout(input: StoryInput, measure: Measure): StoryShape[] {
  const shapes: StoryShape[] = [
    { kind: 'rect', x: 0, y: 0, w: STORY_WIDTH, h: STORY_HEIGHT, r: 0, fill: 'bg' },
    { kind: 'pattern', pattern: input.template.pattern },
  ];
  // The brand: the icon and the name, small at the top.
  shapes.push({ kind: 'image', src: 'logo', x: MARGIN, y: 96, size: 88, framed: true });
  shapes.push({ kind: 'text', text: input.appName, x: MARGIN + 88 + 28, y: 162, font: font(800, 64, FONT_DISPLAY), fill: 'titleInk' });
  // The activity's sticker, large near the top (the app's logo for the default template).
  const sticker = input.template.sticker !== null;
  const size = sticker ? STICKER : 360;
  shapes.push({ kind: 'image', src: sticker ? 'sticker' : 'logo', x: (STORY_WIDTH - size) / 2, y: sticker ? 220 : 270, size, framed: !sticker });

  let y = 700;
  for (const line of wrapText(input.title, INNER_W, 3, TITLE_FONT, measure)) {
    y += 116;
    shapes.push({ kind: 'text', text: line, x: MARGIN, y, font: TITLE_FONT, fill: 'titleInk' });
  }
  // The stamp under the title, tilted.
  y += 56;
  const stampFont = font(800, 60, FONT_DISPLAY);
  const stampW = measure(input.stamp, stampFont) + 68;
  const pivot: [number, number] = [MARGIN + stampW / 2, y + 52];
  shapes.push({ kind: 'rect', x: MARGIN, y, w: stampW, h: 104, r: 20, fill: 'coral', stroke: 6, shadow: 10, rotate: -6 });
  shapes.push({ kind: 'text', text: input.stamp, x: pivot[0], y: y + 73, font: stampFont, fill: 'ink', align: 'center', rotate: -6, pivot });
  y += 104 + 64;

  /** One white info box with its icon, as many text lines as it takes. */
  const textW = INNER_W - 2 * LINE_PAD - ICON - ICON_GAP;
  const box = (icon: StoryIcon, lines: string[]): void => {
    if (lines.length === 0) return;
    const h = lines.length * LINE_STEP + 2 * LINE_PAD - 14;
    shapes.push({ kind: 'rect', x: MARGIN, y, w: INNER_W, h, r: 28, fill: 'paper', stroke: 6, shadow: 10 });
    shapes.push({ kind: 'icon', icon, x: MARGIN + LINE_PAD, y: y + LINE_PAD - 4, size: ICON });
    lines.forEach((line, index) => {
      shapes.push({ kind: 'text', text: line, x: MARGIN + LINE_PAD + ICON + ICON_GAP, y: y + LINE_PAD + 40 + index * LINE_STEP, font: LINE_FONT, fill: 'ink' });
    });
    y += h + 34;
  };
  if (input.when) box('clock', wrapText(input.when, textW, 2, LINE_FONT, measure));
  if (input.place) box('pin', wrapText(input.area ? `${input.place} · ${input.area}` : input.place, textW, 2, LINE_FONT, measure));
  box('users', input.names.length > 0 ? fitNames(input.names, textW, 3, LINE_FONT, measure) : [input.nobodyLabel]);

  shapes.push({ kind: 'text', text: input.footer, x: MARGIN, y: STORY_HEIGHT - 96, font: font(700, 38, FONT_BODY), fill: 'titleInk' });
  return shapes;
}

/** The box icons of the app (ui/icon.tsx) as 24 × 24 path data. */
const ICON_PATHS: Record<StoryIcon, string> = {
  clock: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0zM12 7v5l3 2',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM14.5 10a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0z',
  users: 'M12.5 8a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6',
};

/** A small deterministic generator, so a pattern looks the same every time. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const radius = i % 2 === 0 ? r : r * 0.32;
    const angle = (i * Math.PI) / 4 - Math.PI / 2;
    ctx.lineTo(x + radius * Math.cos(angle), y + radius * Math.sin(angle));
  }
  ctx.closePath();
  ctx.fill();
}

/** The template's geometric pattern over the whole image, faint, in the title ink. */
function drawPattern(ctx: CanvasRenderingContext2D, pattern: StoryPattern, inkColour: string): void {
  if (pattern === 'none') return;
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = inkColour;
  ctx.strokeStyle = inkColour;
  ctx.lineWidth = 6;
  const random = seeded(pattern.length * 7919);
  if (pattern === 'dots') {
    for (let y = 30; y < STORY_HEIGHT; y += 72) for (let x = (y / 72) % 2 ? 66 : 30; x < STORY_WIDTH; x += 72) {
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pattern === 'stripes') {
    ctx.lineWidth = 22;
    for (let x = -STORY_HEIGHT; x < STORY_WIDTH; x += 96) {
      ctx.beginPath();
      ctx.moveTo(x, STORY_HEIGHT);
      ctx.lineTo(x + STORY_HEIGHT, 0);
      ctx.stroke();
    }
  } else if (pattern === 'grid') {
    ctx.lineWidth = 4;
    for (let x = 0; x <= STORY_WIDTH; x += 90) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, STORY_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= STORY_HEIGHT; y += 90) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(STORY_WIDTH, y);
      ctx.stroke();
    }
  } else if (pattern === 'zigzag') {
    ctx.lineWidth = 8;
    for (let y = 60; y < STORY_HEIGHT; y += 120) {
      ctx.beginPath();
      for (let x = -40, up = true; x <= STORY_WIDTH + 40; x += 60, up = !up) ctx.lineTo(x, y + (up ? -24 : 24));
      ctx.stroke();
    }
  } else if (pattern === 'stars') {
    for (let i = 0; i < 46; i++) star(ctx, random() * STORY_WIDTH, random() * STORY_HEIGHT, 14 + random() * 22);
  } else {
    for (let i = 0; i < 90; i++) {
      ctx.save();
      ctx.translate(random() * STORY_WIDTH, random() * STORY_HEIGHT);
      ctx.rotate(random() * Math.PI);
      if (random() < 0.5) ctx.fillRect(-14, -5, 28, 10);
      else {
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export interface StoryImages {
  logo: CanvasImageSource;
  /** The activity's sticker; null for the default template. */
  sticker: CanvasImageSource | null;
}

/** Replays the shapes on a 1080 × 1920 canvas. */
export function drawStory(ctx: CanvasRenderingContext2D, shapes: StoryShape[], colours: StoryColours, images: StoryImages): void {
  for (const shape of shapes) {
    ctx.save();
    if (shape.kind === 'rect') {
      if (shape.rotate) {
        ctx.translate(shape.x + shape.w / 2, shape.y + shape.h / 2);
        ctx.rotate((shape.rotate * Math.PI) / 180);
        ctx.translate(-(shape.x + shape.w / 2), -(shape.y + shape.h / 2));
      }
      if (shape.shadow) {
        ctx.fillStyle = colours.ink;
        roundRect(ctx, shape.x + shape.shadow, shape.y + shape.shadow, shape.w, shape.h, shape.r);
        ctx.fill();
      }
      ctx.fillStyle = colours[shape.fill];
      roundRect(ctx, shape.x, shape.y, shape.w, shape.h, shape.r);
      ctx.fill();
      if (shape.stroke) {
        ctx.lineWidth = shape.stroke;
        ctx.strokeStyle = colours.ink;
        ctx.stroke();
      }
    } else if (shape.kind === 'text') {
      if (shape.rotate && shape.pivot) {
        ctx.translate(shape.pivot[0], shape.pivot[1]);
        ctx.rotate((shape.rotate * Math.PI) / 180);
        ctx.translate(-shape.pivot[0], -shape.pivot[1]);
      }
      ctx.font = shape.font;
      ctx.fillStyle = colours[shape.fill];
      ctx.textAlign = shape.align ?? 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(shape.text, shape.x, shape.y);
    } else if (shape.kind === 'pattern') {
      drawPattern(ctx, shape.pattern, colours.titleInk);
    } else if (shape.kind === 'icon') {
      ctx.translate(shape.x, shape.y);
      ctx.scale(shape.size / 24, shape.size / 24);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = colours.ink;
      ctx.stroke(new Path2D(ICON_PATHS[shape.icon]));
    } else {
      const image = shape.src === 'sticker' ? images.sticker : images.logo;
      if (image) {
        if (shape.framed) {
          const r = shape.size * 0.22;
          ctx.fillStyle = colours.ink;
          roundRect(ctx, shape.x + 8, shape.y + 8, shape.size, shape.size, r);
          ctx.fill();
          ctx.save();
          roundRect(ctx, shape.x, shape.y, shape.size, shape.size, r);
          ctx.clip();
          ctx.drawImage(image, shape.x, shape.y, shape.size, shape.size);
          ctx.restore();
          roundRect(ctx, shape.x, shape.y, shape.size, shape.size, r);
          ctx.lineWidth = 6;
          ctx.strokeStyle = colours.ink;
          ctx.stroke();
        } else ctx.drawImage(image, shape.x, shape.y, shape.size, shape.size);
      }
    }
    ctx.restore();
  }
}

/** The template's colours from tokens.css: the poster keeps its own bright palette whatever the page's theme. */
export function pageColours(template: StoryTemplate): StoryColours {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string): string => style.getPropertyValue(name).trim();
  return {
    bg: v(template.bgToken),
    titleInk: template.ink === 'light' ? v('--story-ink-light') : v('--story-ink'),
    ink: v('--story-ink'),
    paper: v('--story-paper'),
    coral: v('--story-coral'),
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`story: ${src} failed to load`));
    image.src = src;
  });
}

/** The PNG of the story image, drawn once the self-hosted fonts and the images are ready. */
export async function renderStoryPng(input: StoryInput, logoSrc: string): Promise<Blob> {
  const text = [input.when, input.place, input.area, ...input.names].filter(Boolean).join(' ') || input.title;
  await Promise.all([document.fonts.load(TITLE_FONT, input.title), document.fonts.load(LINE_FONT, text), document.fonts.load(font(700, 38, FONT_BODY), input.footer)]);
  await document.fonts.ready;
  const [logo, sticker] = await Promise.all([loadImage(logoSrc), input.template.sticker ? loadImage(input.template.sticker) : Promise.resolve(null)]);
  const canvas = document.createElement('canvas');
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('story: no 2d context');
  const measure: Measure = (value, fontSpec) => {
    ctx.font = fontSpec;
    return ctx.measureText(value).width;
  };
  drawStory(ctx, storyLayout(input, measure), pageColours(input.template), { logo, sticker });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('story: PNG encode failed'))), 'image/png'));
}

/** Shares the image to the device's share sheet when it takes files, else downloads it. */
export async function shareOrDownloadStory(blob: Blob, fileName: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], fileName, { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the download a moment to start before the URL goes.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
