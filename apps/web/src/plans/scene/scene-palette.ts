/** The scene's colours, read from tokens.css at build time of the scene (colours live only there). */
import { SCENE_GROUPS, type SceneGroup } from './scene-model';

const TOKENS = {
  skyTop: '--scene-sky-top',
  skyMid: '--scene-sky-mid',
  skyGlow: '--scene-sky-glow',
  skyLow: '--scene-sky-low',
  fog: '--scene-fog',
  hemiSky: '--scene-hemi-sky',
  hemiGround: '--scene-hemi-ground',
  sun: '--scene-sun',
  fill: '--scene-fill',
  red: '--scene-red',
  redDark: '--scene-red-dark',
  wainscot: '--scene-wainscot',
  yellow: '--scene-yellow',
  yellowDeep: '--scene-yellow-deep',
  yellowPale: '--scene-yellow-pale',
  floor: '--scene-floor',
  floorGrout: '--scene-floor-grout',
  kerb: '--scene-kerb',
  road: '--scene-road',
  roadMark: '--scene-road-mark',
  brick: '--scene-brick',
  mortar: '--scene-mortar',
  shelf: '--scene-shelf',
  bottleAmber: '--scene-bottle-amber',
  bottleGreen: '--scene-bottle-green',
  keg: '--scene-keg',
  kegRing: '--scene-keg-ring',
  crate: '--scene-crate',
  table: '--scene-table',
  tableDark: '--scene-table-dark',
  chair: '--scene-chair',
  plate: '--scene-plate',
  snack: '--scene-snack',
  tissue: '--scene-tissue',
  glass: '--scene-glass',
  glassBase: '--scene-glass-base',
  beer: '--scene-beer',
  beerGlow: '--scene-beer-glow',
  foam: '--scene-foam',
  dark: '--scene-dark',
  black: '--scene-black',
  motoRed: '--scene-moto-red',
  motoBlue: '--scene-moto-blue',
  motoSeat: '--scene-moto-seat',
  headlight: '--scene-headlight',
  board: '--scene-board',
  boardFrame: '--scene-board-frame',
  chalk: '--scene-chalk',
  post: '--scene-post',
  trousers: '--scene-trousers',
  shoe: '--scene-shoe',
  labelBg: '--scene-label-bg',
  bubble: '--scene-bubble',
  bubbleInk: '--scene-bubble-ink',
  labelInk: '--c-text',
  onStatus: '--c-bg',
} as const;

export type PaletteKey = keyof typeof TOKENS;

export interface ScenePalette extends Record<PaletteKey, string> {
  skins: string[];
  hairs: string[];
  shirts: string[];
}

const FAMILY_SIZES = { skin: 4, hair: 4, shirt: 8 } as const;

export function readScenePalette(style: CSSStyleDeclaration = getComputedStyle(document.documentElement)): ScenePalette {
  const read = (name: string): string => style.getPropertyValue(name).trim();
  const family = (name: keyof typeof FAMILY_SIZES): string[] => Array.from({ length: FAMILY_SIZES[name] }, (_, i) => read(`--scene-${name}-${i + 1}`));
  const flat = Object.fromEntries(Object.entries(TOKENS).map(([key, token]) => [key, read(token)])) as Record<PaletteKey, string>;
  return { ...flat, skins: family('skin'), hairs: family('hair'), shirts: family('shirt') };
}

/** The colour of each group: its ring, label dot and chip dot. */
export function readStatusColours(style: CSSStyleDeclaration = getComputedStyle(document.documentElement)): Record<SceneGroup, string> {
  return Object.fromEntries(SCENE_GROUPS.map((group) => [group, style.getPropertyValue(`--status-${group}`).trim()])) as Record<SceneGroup, string>;
}
