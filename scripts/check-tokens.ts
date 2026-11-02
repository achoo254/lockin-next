/**
 * `pnpm check:tokens`: design-token guard of the web app.
 *
 * 1. No colour literal in apps/web/src (ts, tsx, css) or apps/web/index.html outside src/ui/tokens.css.
 * 2. Every text/background pair the UI uses meets WCAG 2 AA (text 4.5:1): on every surface, and on every fill and
 *    tint that carries text (dark on coral and lime); the focus ring and control outlines at 3:1 (non-text).
 *
 * Exits 1 on any failure, printing file:line for literals and the ratio of each failing pair.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LiteralViolation, type TokenMap, contrastRatio, findColourLiterals, parseTokens } from './token-contrast';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps/web');
const TOKENS_FILE = path.join(WEB, 'src/ui/tokens.css');
const SCANNED = new Set(['.ts', '.tsx', '.css']);
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/** Foreground tokens and the backgrounds each must be readable on (coral and lime are never text on the page). */
const SCREEN_TEXT = ['--c-text', '--c-text-muted', '--c-error', '--c-ok'];
const SCREEN_BACKGROUNDS = ['--c-bg', '--c-surface', '--c-surface-subtle', '--c-hover'];
/** Fills and tints with text on them, and the text tokens they carry. */
const FILLS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['--c-primary-solid', ['--c-on-primary']],
  ['--c-primary-solid-hover', ['--c-on-primary']],
  ['--c-primary-soft', ['--c-text', '--c-text-muted']],
  ['--c-lock', ['--c-on-lock']],
  ['--c-lock-soft', ['--c-text', '--c-text-muted']],
  ['--c-accent', ['--c-on-accent']],
  ['--c-accent-soft', ['--c-text', '--c-text-muted']],
  ['--c-warn-soft', ['--c-text']],
  ['--c-error-soft', ['--c-text', '--c-error']],
  ['--c-chat', ['--c-text']],
  ['--c-text', ['--c-on-ink']],
  // Lime as text and icon colour on dark surfaces (the hero's highlight, the ticket's fact icons).
  ['--c-bg', ['--c-lock']],
  ['--c-surface-subtle', ['--c-lock']],
  // Story-image templates (plans/story-templates.ts): the title ink on each background.
  ['--c-lock', ['--story-ink']],
  ...['cafe', 'food', 'karaoke', 'trip', 'birthday', 'lunch', 'teambuilding', 'meeting'].map((name) => [`--story-${name}`, ['--story-ink']] as const),
  ...['movie', 'party'].map((name) => [`--story-${name}`, ['--story-ink-light']] as const),
];
/** Non-text marks at 3:1: the focus ring, and the outline of a control (input, vote box, link box) on what it sits on. */
const MARKS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['--c-focus', ['--c-bg', '--c-surface', '--c-surface-subtle']],
  ['--c-border', ['--c-bg', '--c-surface', '--c-surface-subtle']],
  ['--c-warn', ['--c-bg', '--c-surface']],
];

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return SCANNED.has(path.extname(entry.name)) ? [full] : [];
    }),
  );
  return nested.flat();
}

async function literalViolations(): Promise<LiteralViolation[]> {
  const files = [...(await sourceFiles(path.join(WEB, 'src'))).filter((f) => f !== TOKENS_FILE), path.join(WEB, 'index.html')];
  const results = await Promise.all(files.map(async (file) => findColourLiterals(await readFile(file, 'utf8'), path.relative(ROOT, file))));
  return results.flat();
}

function value(tokens: TokenMap, name: string): string {
  const found = tokens.get(name);
  if (found === undefined) throw new Error(`tokens.css does not define ${name}`);
  return found;
}

/** Every pair to check: [label, foreground colour, background colour, minimum ratio]. */
function pairs(tokens: TokenMap): Array<readonly [string, string, string, number]> {
  const v = (name: string): string => value(tokens, name);
  const list: Array<readonly [string, string, string, number]> = [];
  for (const fg of SCREEN_TEXT) for (const bg of SCREEN_BACKGROUNDS) list.push([`${fg} on ${bg}`, v(fg), v(bg), AA_TEXT]);
  for (const [fill, texts] of FILLS) for (const fg of texts) list.push([`${fg} on ${fill}`, v(fg), v(fill), AA_TEXT]);
  for (const [mark, backgrounds] of MARKS) for (const bg of backgrounds) list.push([`${mark} (mark) on ${bg}`, v(mark), v(bg), AA_NON_TEXT]);
  return list;
}

async function main(): Promise<number> {
  let failed = false;
  const violations = await literalViolations();
  if (violations.length > 0) {
    failed = true;
    console.error(`✗ ${violations.length} colour literal(s) outside apps/web/src/ui/tokens.css:`);
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.match}`);
  } else {
    console.log('✓ No colour literals outside tokens.css');
  }

  const checked = pairs(parseTokens(await readFile(TOKENS_FILE, 'utf8')));
  const failures = checked
    .map(([label, fg, bg, minimum]) => ({ label, minimum, ratio: contrastRatio(fg, bg) }))
    .filter((pair) => pair.ratio < pair.minimum)
    .map((pair) => `  ${pair.ratio.toFixed(2)}:1 < ${pair.minimum}:1  ${pair.label}`);
  if (failures.length > 0) {
    failed = true;
    console.error(`✗ ${failures.length} of ${checked.length} contrast pair(s) below WCAG AA:`);
    for (const line of failures) console.error(line);
  } else {
    console.log(`✓ ${checked.length} contrast pairs meet WCAG AA (text ${AA_TEXT}:1, outlines ${AA_NON_TEXT}:1)`);
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error('check:tokens crashed:', error);
    process.exitCode = 1;
  },
);
