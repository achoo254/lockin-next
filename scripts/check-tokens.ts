/**
 * `pnpm check:tokens`: design-token guard of the web app.
 *
 * 1. No colour literal in apps/web/src (ts, tsx, css) or apps/web/index.html outside src/ui/tokens.css.
 * 2. Every text/background pair the UI uses meets WCAG 2 AA (text 4.5:1): on every surface, on the chips that carry
 *    text, on the alert tints; white on the solid buttons; the form-control outline at 3:1 (non-text).
 *
 * Exits 1 on any failure, printing file:line for literals and the ratio of each failing pair.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LiteralViolation, type TokenMap, contrastRatio, findColourLiterals, mixHex, parseTokens } from './token-contrast';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps/web');
const TOKENS_FILE = path.join(WEB, 'src/ui/tokens.css');
const SCANNED = new Set(['.ts', '.tsx', '.css']);
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/** Foreground tokens and the backgrounds each must be readable on. */
const SCREEN_TEXT = ['--c-text', '--c-text-muted', '--c-primary', '--c-accent-text', '--c-error', '--c-info'];
const SCREEN_BACKGROUNDS = ['--c-bg', '--c-bg-deep', '--c-surface', '--c-surface-subtle', '--c-surface-raised', '--c-topbar'];
/** Chips with text on them, and the text tokens they carry. */
const CHIPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['--c-chip-violet', ['--c-text', '--c-primary']],
  ['--c-chip-pink', ['--c-text', '--c-accent-text']],
  ['--c-chip-mint', ['--c-text']],
  ['--c-accent-soft', ['--c-text', '--c-text-muted']],
];
/** Alert tints (app.css: color-mix of the tone over the surface) and the share of the tone. */
const TINTS: ReadonlyArray<readonly [string, number]> = [
  ['--c-error', 0.08],
  ['--c-info', 0.08],
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
  for (const [chip, texts] of CHIPS) for (const fg of texts) list.push([`${fg} on ${chip}`, v(fg), v(chip), AA_TEXT]);
  for (const [tone, share] of TINTS) list.push([`--c-text on the ${tone} alert`, v('--c-text'), mixHex(v(tone), v('--c-surface'), share), AA_TEXT]);
  for (const bg of ['--c-primary-solid', '--c-primary-solid-hover']) list.push([`--c-on-primary on ${bg}`, v('--c-on-primary'), v(bg), AA_TEXT]);
  for (const bg of ['--c-surface', '--c-surface-subtle']) list.push([`--c-border-strong (outline) on ${bg}`, v('--c-border-strong'), v(bg), AA_NON_TEXT]);
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
