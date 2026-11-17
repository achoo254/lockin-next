/**
 * A solo game plan ("kèo solo": two players, one lane, house rules) carries a `duel`: the game, how many rounds, how a
 * round is won, the house rules (a closed list of presets plus the creator's own lines) and an optional friendly
 * stake. Pure module: the server schema, the API input and the web form all import it.
 */

export const GAMES = ['lien_quan', 'lmht', 'wild_rift', 'other'] as const;
export type Game = (typeof GAMES)[number];

/** Rounds of the duel: first to win more than half. */
export const BEST_OF = [1, 3, 5] as const;
export type BestOf = (typeof BEST_OF)[number];

/** How a round is won. */
export const WIN_CONDITIONS = ['first_blood', 'first_tower', 'first_3_kills', 'first_base'] as const;
export type WinCondition = (typeof WIN_CONDITIONS)[number];

/** House rules, the usual ones of a 1v1 in Liên Quân and Liên Minh; the labels live in the web messages. */
export const DUEL_RULES = [
  'basic_attacks_only',
  'no_summoner_spells',
  'no_bush',
  'no_minion_farm',
  'no_heal',
  'no_recall',
  'stay_in_lane',
  'no_gank',
  'same_hero',
] as const;
export type DuelRule = (typeof DUEL_RULES)[number];

/** The rules ticked when a solo plan is started: the ones that make a 1v1 a 1v1. */
export const DEFAULT_DUEL_RULES: readonly DuelRule[] = ['basic_attacks_only', 'no_bush', 'no_minion_farm', 'no_heal'];

export const MAX_CUSTOM_RULES = 5;
export const MAX_CUSTOM_RULE_LENGTH = 80;
export const MAX_STAKE_LENGTH = 80;

export interface Duel {
  game: Game;
  bestOf: BestOf;
  winCondition: WinCondition;
  rules: DuelRule[];
  customRules: string[];
  /** What the loser owes ("bao ly trà sữa"); null for none. */
  stake: string | null;
}
