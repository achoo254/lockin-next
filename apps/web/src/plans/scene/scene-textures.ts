/** Canvas-drawn textures of the scene: signs, floor, bricks, name labels and speech bubbles. Colours come from the palette. */
import * as THREE from 'three';
import { FONT_BODY, FONT_DISPLAY, type Measure, wrapText } from '../story-image';
import type { ScenePalette } from './scene-palette';

/** In-world signs are decoration in Vietnamese whatever the page language is. */
export const SIGN_NAME = 'BIA HƠI HÀ NỘI';
export const SIGN_SNACKS = 'Nem chua · Lạc rang · Đậu rán';

export interface Signage {
  /** The locked place, on the round sign of the shop front. */
  placeName: string;
  area: string | null;
}

const font = (weight: number, size: number, family: string): string => `${weight} ${size}px ${family}`;

export function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('scene: no 2d context');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A small deterministic generator, so the street looks the same every time. */
export function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const shade = (colour: string, factor: number): string => new THREE.Color(colour).multiplyScalar(factor).getStyle();

/** Loads the self-hosted fonts the signs and labels use, so the first draw does not fall back to a system font. */
export async function loadSceneFonts(sample: string): Promise<void> {
  await Promise.all([
    document.fonts.load(font(800, 60, FONT_DISPLAY), sample),
    document.fonts.load(font(700, 40, FONT_BODY), sample),
    document.fonts.load(font(600, 40, FONT_BODY), sample),
  ]);
  await document.fonts.ready;
}

export function skyTexture(p: ScenePalette): THREE.CanvasTexture {
  return canvasTexture(2, 256, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, p.skyTop);
    gradient.addColorStop(0.45, p.skyMid);
    gradient.addColorStop(0.6, p.skyGlow);
    gradient.addColorStop(1, p.skyLow);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
}

export function floorTexture(p: ScenePalette): THREE.CanvasTexture {
  const texture = canvasTexture(256, 256, (ctx, w, h) => {
    const random = seeded(7);
    ctx.fillStyle = p.floorGrout;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      ctx.fillStyle = shade(p.floor, 0.95 + random() * 0.06);
      ctx.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(7, 1.6);
  return texture;
}

export function kerbTexture(p: ScenePalette): THREE.CanvasTexture {
  const texture = canvasTexture(128, 32, (ctx, w, h) => {
    ctx.fillStyle = p.kerb;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = p.red;
    for (let i = 0; i < 4; i++) ctx.fillRect(i * 32 + 16, 0, 16, h);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(14, 1);
  return texture;
}

export function brickTexture(p: ScenePalette): THREE.CanvasTexture {
  const texture = canvasTexture(256, 128, (ctx, w, h) => {
    const random = seeded(11);
    ctx.fillStyle = p.mortar;
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) for (let i = -1; i < 8; i++) {
      ctx.fillStyle = shade(p.brick, 0.92 + random() * 0.16);
      ctx.fillRect(i * 32 + (row % 2) * 16 + 2, row * 16 + 2, 28, 12);
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 1);
  return texture;
}

export function pillarTexture(p: ScenePalette): THREE.CanvasTexture {
  return canvasTexture(128, 512, (ctx, w, h) => {
    ctx.fillStyle = p.yellow;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = p.red;
    ctx.fillRect(0, 0, 10, h);
    ctx.fillRect(w - 10, 0, 10, h);
    ctx.textAlign = 'center';
    ctx.font = font(800, 76, FONT_DISPLAY);
    SIGN_NAME.split(' ').forEach((word, i) => ctx.fillText(word, w / 2, 130 + i * 108));
    ctx.beginPath();
    ctx.arc(w / 2, 52, 22, 0, Math.PI * 2);
    ctx.fill();
  });
}

const DISC_TEXT_WIDTH = 130;

/** The largest size at which the place name fits the red disc in at most two lines without a cut. */
function fitInDisc(text: string, measure: Measure): { lines: string[]; size: number } {
  for (const size of [64, 52, 44, 36]) {
    const spec = font(800, size, FONT_DISPLAY);
    const lines = wrapText(text, DISC_TEXT_WIDTH, 2, spec, measure);
    if (!lines.some((line) => line.endsWith('…'))) return { lines, size };
  }
  return { lines: wrapText(text, DISC_TEXT_WIDTH, 2, font(800, 34, FONT_DISPLAY), measure), size: 34 };
}

/** The fascia: the generic name on the left, the locked place in a red disc, the area and the snacks on the right. */
export function fasciaTexture(p: ScenePalette, signage: Signage): THREE.CanvasTexture {
  return canvasTexture(2048, 200, (ctx, w, h) => {
    ctx.fillStyle = p.yellow;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = p.red;
    ctx.textAlign = 'center';
    ctx.font = font(800, 96, FONT_DISPLAY);
    ctx.fillText(SIGN_NAME, 420, 126);
    ctx.beginPath();
    ctx.arc(1024, 100, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.yellow;
    const measure: Measure = (text, spec) => {
      ctx.font = spec;
      return ctx.measureText(text).width;
    };
    const { lines, size } = fitInDisc(signage.placeName, measure);
    ctx.font = font(800, size, FONT_DISPLAY);
    const top = 100 - ((lines.length - 1) * size * 0.95) / 2 + size * 0.3;
    lines.forEach((line, i) => ctx.fillText(line, 1024, top + i * size * 0.95));
    ctx.fillStyle = p.red;
    if (signage.area) {
      ctx.font = font(700, 56, FONT_BODY);
      ctx.fillText(wrapText(signage.area, 560, 1, font(700, 56, FONT_BODY), measure)[0] ?? '', 1500, 88);
    }
    ctx.font = font(600, 44, FONT_BODY);
    ctx.fillText(SIGN_SNACKS, 1500, signage.area ? 148 : 112);
  });
}

export function roundSignTexture(p: ScenePalette): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = p.red;
    ctx.beginPath();
    ctx.arc(128, 128, 126, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.yellow;
    ctx.beginPath();
    ctx.arc(128, 128, 104, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.red;
    ctx.textAlign = 'center';
    ctx.font = font(800, 54, FONT_DISPLAY);
    ctx.fillText('BIA HƠI', 128, 124);
    ctx.font = font(800, 42, FONT_DISPLAY);
    ctx.fillText('HÀ NỘI', 128, 176);
  });
}

/** The small chalkboard of a standing spot: a clock or a pin and a word. */
export function boardTexture(p: ScenePalette, label: string, icon: 'clock' | 'pin'): THREE.CanvasTexture {
  return canvasTexture(256, 192, (ctx, w, h) => {
    ctx.fillStyle = p.board;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = p.boardFrame;
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.strokeStyle = p.chalk;
    ctx.fillStyle = p.chalk;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (icon === 'clock') {
      ctx.beginPath();
      ctx.arc(128, 62, 36, 0, Math.PI * 2);
      ctx.moveTo(128, 40);
      ctx.lineTo(128, 64);
      ctx.lineTo(146, 74);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(128, 104);
      ctx.bezierCurveTo(88, 70, 92, 28, 128, 28);
      ctx.bezierCurveTo(164, 28, 168, 70, 128, 104);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(128, 62, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = font(700, 34, FONT_BODY);
    ctx.textAlign = 'center';
    ctx.fillText(label, 128, 158, 230);
  });
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
}

/** The name label over a head: a dark pill with the group's dot holding the initial. */
export function labelTexture(p: ScenePalette, name: string, statusColour: string): THREE.CanvasTexture {
  const shown = name.length > 14 ? `${name.slice(0, 13)}…` : name;
  return canvasTexture(512, 112, (ctx, w) => {
    ctx.font = font(700, 40, FONT_BODY);
    const textW = Math.min(ctx.measureText(shown).width, 380);
    const boxW = textW + 104;
    const x0 = (w - boxW) / 2;
    ctx.fillStyle = p.labelBg;
    pill(ctx, x0, 12, boxW, 88);
    ctx.fill();
    ctx.fillStyle = statusColour;
    ctx.beginPath();
    ctx.arc(x0 + 46, 56, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.onStatus;
    ctx.textAlign = 'center';
    ctx.font = font(800, 36, FONT_BODY);
    ctx.fillText(name.trim().charAt(0).toUpperCase(), x0 + 46, 69);
    ctx.fillStyle = p.labelInk;
    ctx.textAlign = 'left';
    ctx.font = font(700, 40, FONT_BODY);
    ctx.fillText(shown, x0 + 90, 69, 380);
  });
}

/** A speech bubble with a tail, outlined in the group's colour. */
export function bubbleTexture(p: ScenePalette, text: string, statusColour: string): THREE.CanvasTexture {
  return canvasTexture(512, 150, (ctx, w) => {
    ctx.font = font(700, 36, FONT_BODY);
    const textW = Math.min(ctx.measureText(text).width, 460);
    const boxW = textW + 44;
    const x0 = (w - boxW) / 2;
    ctx.fillStyle = p.bubble;
    ctx.beginPath();
    ctx.roundRect(x0, 8, boxW, 78, 26);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = statusColour;
    ctx.stroke();
    ctx.fillStyle = p.bubble;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 16, 82);
    ctx.lineTo(w / 2 + 4, 126);
    ctx.lineTo(w / 2 + 20, 82);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = statusColour;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 16, 84);
    ctx.lineTo(w / 2 + 4, 126);
    ctx.lineTo(w / 2 + 20, 84);
    ctx.stroke();
    ctx.fillStyle = p.bubble;
    ctx.fillRect(w / 2 - 12, 80, 28, 8);
    ctx.fillStyle = p.bubbleInk;
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, 60, 460);
  });
}
