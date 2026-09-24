// Diplomacy: the shapes and tuning for relations between nations, wars, and
// peace. Data-only — see state/diplomacyStore.ts for the live state and
// scene/warScore.ts for how a war's score is derived.
//
// Relations are between PAIRS of nations and are symmetric (a war between
// Mars and Venus is one war, seen from both sides), so they're keyed by a
// sorted pair — see pairKey.

export type RelationStatus = 'peace' | 'war'

export interface Relation {
  status: RelationStatus
  // Absolute simDays before which neither side may declare war on the other
  // — set when a war ends. 0 means no truce.
  truceUntilSimDays: number
  // -100 (hatred) .. +100 (warm). Drives AI war/peace decisions; purely
  // informational for the player.
  opinion: number
}

export type PeaceTerms = { kind: 'white' } | { kind: 'cede'; bodies: string[] }

export interface War {
  id: string
  attackerId: string
  defenderId: string
  startedSimDays: number
  // Running battle balance from the ATTACKER's point of view: value of
  // defender ships destroyed minus value of attacker ships destroyed. War
  // score adds occupied territory on top of this (see scene/warScore.ts).
  battleBalance: number
  // Grows with time at war and with losses; high exhaustion makes a nation
  // accept a worse peace.
  exhaustion: Record<string, number>
}

export type DiplomacyEventKind = 'war-declared' | 'peace-offered' | 'peace-signed' | 'peace-rejected' | 'body-occupied' | 'body-ceded'

export interface DiplomacyEvent {
  id: string
  simDays: number
  kind: DiplomacyEventKind
  // The nations involved, in the order the text reads (e.g. [declarer, target]).
  countryIds: string[]
  text: string
}

// How long both sides must wait after a peace before either may declare war
// again, in sim-days. ~2 years — long enough that peace means something.
export const TRUCE_DAYS = 730

// Opinion bounds and the neutral starting point for a pair that has never
// interacted.
export const OPINION_MIN = -100
export const OPINION_MAX = 100
export const STARTING_OPINION = 0

// Opinion change applied to BOTH sides' view of each other on these events.
export const OPINION_ON_WAR_DECLARED = -60
export const OPINION_ON_PEACE = 15

// How many diplomacy events the log keeps.
export const MAX_DIPLOMACY_EVENTS = 60

// Order-independent key for a pair of nations.
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function defaultRelation(): Relation {
  return { status: 'peace', truceUntilSimDays: 0, opinion: STARTING_OPINION }
}

// --- War score (see scene/warScore.ts) --------------------------------------
//
// How much each kind of body is worth when occupied. Score from occupation is
// the share of the enemy's total value you hold, so these only matter
// relative to each other.
export const BODY_VALUE_CAPITAL = 40
export const BODY_VALUE_WORLD = 20
export const BODY_VALUE_OUTPOST = 5
// Battles add at most this much war score either way, however lopsided.
// A starting navy is ~3,400 hit points, so wiping one out is worth ~25.
export const BATTLE_SCORE_MAX = 30
export const BATTLE_SCORE_SCALE_HP = 2000
// Destroyed armies count toward battle balance and exhaustion at this many
// "hit points" per point of army max strength.
export const ARMY_LOSS_VALUE_PER_STRENGTH = 2

// --- Exhaustion (0..100) ----------------------------------------------------
export const EXHAUSTION_PER_YEAR = 20
// Hit points of losses per point of exhaustion (a starting navy ≈ 43 points).
export const EXHAUSTION_LOSS_HP_PER_POINT = 80

// --- Peace acceptance (see scene/warScore.evaluatePeace) --------------------
// A side accepts a white peace unless it's winning by more than this...
export const WHITE_PEACE_MAX_SCORE = 15
// ...or, if it's exhausted past this, unless winning by more than
// WHITE_PEACE_EXHAUSTED_MAX_SCORE.
export const WHITE_PEACE_EXHAUSTION = 60
export const WHITE_PEACE_EXHAUSTED_MAX_SCORE = 50
// A loser cedes bodies when the winner's score covers what they're worth.
// Exhaustion past this halves the score needed.
export const CEDE_EXHAUSTION = 80
