/**
 * The creator's saved list of friends' names, kept in this browser (localStorage) so the next plan starts with them
 * already in place. Never sent anywhere until a plan is made with some of them. Reading or writing can fail (private
 * windows, blocked storage); then the list simply is not remembered.
 */
import { uniqueNames } from '../../../server/src/plans/member-names';

const KEY = 'lockin.roster';

export function loadRoster(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? uniqueNames(parsed.filter((item): item is string => typeof item === 'string')) : [];
  } catch {
    return [];
  }
}

export function saveRoster(names: readonly string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(uniqueNames(names)));
  } catch {
    // Not remembered: the plan being made still has its names.
  }
}

/** Names typed or pasted in one go ("An, Bình\nChi"), split at commas, semicolons and line breaks, each cut to 40 characters. */
export function splitNames(text: string): string[] {
  return uniqueNames(text.split(/[,;\n]/).map((part) => part.trim().slice(0, 40)));
}
