/**
 * The names of the people a creator expects in a plan. A name is matched to a person who joined by its key: case,
 * accents, the letter đ and runs of spaces do not matter ("Hùng  Béo" is "hung beo"), so a friend who types their
 * name a little differently still counts as voted. Shared by the API (no duplicates in the list) and the web app.
 */

export const MAX_MEMBER_NAMES = 50;

export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The names without repeats (the first spelling stays), empty ones dropped, at most MAX_MEMBER_NAMES. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ');
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, MAX_MEMBER_NAMES);
}
