import { describe, expect, it } from 'vitest';
import { contrastRatio, findColourLiterals, mixHex, parseTokens } from './token-contrast';

describe('token checks', () => {
  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('mixes colours like color-mix in srgb', () => {
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mixHex('#ffffff', '#d9c7e1', 1)).toBe('#ffffff');
  });

  it('reads every custom property of the token file, comments left out', () => {
    const tokens = parseTokens(`/* --x: #000000; */ :root { --a: #111111; --b: url("data:image/svg+xml,%3Csvg fill='%23fff'%3E"); }
      @media (min-width: 768px) { :root { --gap: 24px; } }`);
    expect(tokens.get('--a')).toBe('#111111');
    expect(tokens.get('--b')).toBe(`url("data:image/svg+xml,%3Csvg fill='%23fff'%3E")`);
    expect(tokens.get('--gap')).toBe('24px');
    expect(tokens.has('--x')).toBe(false);
  });

  it('finds colour literals with their line', () => {
    expect(findColourLiterals('a\ncolor: #fff;\nfill: rgb(0 0 0)\n&#123; id="#main"', 'x.css')).toEqual([
      { file: 'x.css', line: 2, match: '#fff' },
      { file: 'x.css', line: 3, match: 'rgb(' },
    ]);
  });
});
