import { readFileSync } from 'node:fs';
import { iconSourceHashes } from '@achoo254/brand/build';
import { describe, expect, it } from 'vitest';
import { BRAND_GENERATED_DIR, BRAND_ROOT, loadLockinBrand } from '../apps/web/vite-brand';

describe('generated brand files', () => {
  it('were drawn from the current brand icons (run pnpm brand:gen after changing them)', () => {
    const recorded: unknown = JSON.parse(readFileSync(new URL('icons/icons-source.json', BRAND_GENERATED_DIR), 'utf8'));
    expect(recorded).toEqual(iconSourceHashes(loadLockinBrand(), BRAND_ROOT));
  });

  it('embed the AI-drawn master with its licence line', () => {
    for (const file of ['brand/app-icon.svg', 'brand/app-icon-maskable.svg']) {
      const svg = readFileSync(new URL(file, BRAND_ROOT), 'utf8');
      expect(svg).toContain('AI-generated (OpenAI gpt-image-2) for the hoandat ecosystem');
      expect(svg).toContain('data:image/webp;base64,');
    }
  });
});
