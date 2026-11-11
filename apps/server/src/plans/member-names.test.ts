import { describe, expect, it } from 'vitest';
import { MAX_MEMBER_NAMES, nameKey, uniqueNames } from './member-names';

describe('member names', () => {
  it('matches a name whatever its case, accents, đ and spaces', () => {
    expect(nameKey('  Hùng   Béo ')).toBe('hung beo');
    expect(nameKey('Đạt')).toBe(nameKey('dat'));
    expect(nameKey('MINH')).toBe(nameKey('minh'));
  });

  it('drops empty names and repeats, keeping the first spelling and the order', () => {
    expect(uniqueNames(['An', ' ', 'Bình', 'an', 'Binh', 'Chi'])).toEqual(['An', 'Bình', 'Chi']);
  });

  it('keeps at most the limit', () => {
    expect(uniqueNames(Array.from({ length: MAX_MEMBER_NAMES + 10 }, (_, i) => `Bạn ${i}`))).toHaveLength(MAX_MEMBER_NAMES);
  });
});
