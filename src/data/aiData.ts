// Strategic AI tuning (see src/ai/). Every number is a pick for the demo, not
// a balance decision; change the constants, not the agents.

// How often each AI empire replans, in sim-days. Empires are staggered across
// this interval so they don't all plan in the same frame.
export const AI_PLAN_INTERVAL_DAYS = 5

// --- Diplomat ---------------------------------------------------------------
// Opinion recovery per planning pass, toward 0, for a nation with a real
// grievance still on the books (e.g. a past war) — capped so it never
// overshoots past neutral in one pass.
export const AI_OPINION_RECOVERY = 0.25
// Minimum sim-days between peace offers in one war.
export const AI_PEACE_OFFER_COOLDOWN_DAYS = 60
// Offers made to the PLAYER are throttled harder, since each one stops the
// game for a decision. Minimum sim-days between offers to the player in one
// war — doubling each time the player declines, up to the cap...
export const AI_PLAYER_OFFER_COOLDOWN_DAYS = 180
export const AI_PLAYER_OFFER_MAX_COOLDOWN_DAYS = 1440
// ...and between any two offers to the player, from any empire.
export const AI_PLAYER_OFFER_MIN_GAP_DAYS = 60
// An AI empire looks for a white peace when losing by this much...
export const AI_WHITE_PEACE_WHEN_SCORE_BELOW = -30
// ...or this exhausted...
export const AI_WHITE_PEACE_WHEN_EXHAUSTION = 50
// ...or after this long in a stalemate (|score| under AI_STALEMATE_SCORE).
export const AI_STALEMATE_DAYS = 730
export const AI_STALEMATE_SCORE = 10
// Holding enemy ground its score could already claim, it keeps fighting for
// more while under this exhaustion and this many days into the war — as long
// as enemy-held ground remains in its theatre.
export const AI_PRESS_ON_EXHAUSTION = 30
export const AI_PRESS_ON_DAYS = 180
// Winning by at least this with no whole world it can claim, once it stops
// pressing on it settles for reparations (a share of the loser's stockpile).
export const AI_REPARATIONS_MIN_SCORE = 10

// --- Strategist -------------------------------------------------------------
// No AI war declarations before this sim-day (the clock starts at day 0).
export const AI_WAR_GRACE_DAYS = 90
// Opinion at or below which an empire will consider war on a neighbour.
export const AI_WAR_OPINION = -25
// Power ratio it wants over the target: this much at AI_WAR_OPINION, falling
// linearly to AI_WAR_RATIO_AT_HATRED at AI_HATRED_OPINION.
export const AI_WAR_RATIO = 1.5
export const AI_WAR_RATIO_AT_HATRED = 1.0
export const AI_HATRED_OPINION = -85
// It won't start a war without at least this many assault armies to invade with.
export const AI_MIN_ARMIES_FOR_WAR = 2

// --- Shipwright -------------------------------------------------------------
// Target warship and assault-army counts by posture.
export const AI_WARSHIP_TARGET = { peace: 6, buildup: 9, defensive: 10, war: 12 } as const
export const AI_ARMY_TARGET = { peace: 2, buildup: 4, defensive: 3, war: 6 } as const
// What it builds, in rotation — a mixed line so no single counter wrecks it.
export const AI_WARSHIP_ROTATION = ['destroyer', 'frigate', 'corvette', 'cruiser'] as const
// Orders it keeps waiting in its shipyard queue at most.
export const AI_MAX_QUEUED_BUILDS = 1

// --- Admiral ----------------------------------------------------------------
// It commits the navy to a fight only with at least this much power over the
// enemy warships there...
export const AI_ATTACK_POWER_RATIO = 1.2
// ...and defends a threatened body if it has at least this much.
export const AI_DEFEND_POWER_RATIO = 0.8

// --- Marshal ----------------------------------------------------------------
// It lands an invasion only when its armies' estimated fighting value
// (Lanchester: total attack × total defense) is at least this multiple of the
// defenders' — whose defense counts their key-node fortification and cities.
export const AI_INVASION_POWER_RATIO = 0.9

// --- Expander ---------------------------------------------------------------
// Ships an empire keeps for exploring, surveying and claiming systems: one
// science ship always, and (once Orbital Construction is researched) a
// construction ship and a cargo ship to resupply it.
export const AI_SCIENCE_SHIPS = 1
export const AI_CONSTRUCTION_SHIPS = 1
export const AI_CARGO_SHIPS = 1
// Colony Ships it keeps at once (Simple mode, when it can afford a colony).
export const AI_COLONY_SHIPS = 1
// Most Starbases an empire builds by itself (no attempt yet at judging how
// many is enough).
export const AI_MAX_STARBASES = 3
// What it researches, in order, on the way to being able to build a Starbase.
// Warp Theory and Warp Comms are starting techs (techStore.DEFAULT_RESEARCHED);
// they stay listed first so an empire somehow without them fetches them before
// anything else (orders beyond its own system are useless at light speed).
// Research income only exists in Simple economy mode (nothing feeds it in
// Complex), so in Complex an AI stays where it is.
export const AI_RESEARCH_PATH = ['warp-theory', 'warp-drives', 'warp-comms', 'classical-mechanics', 'orbital-mechanics', 'orbital-construction'] as const

// --- Diplomacy (diplomat.ts): orgs, subjects, trade policy ---------------------
// Opinion at or above which a nation is "friendly" enough to form or join an
// international organization with at peace.
export const AI_ORG_FRIENDLY_OPINION = 25
// A member keeps opinion of fellow org members topped up to at least this, by
// the org's political-forum/cultural bonus (above the friendly threshold, so
// membership actively builds goodwill rather than just reflecting it).
export const AI_ORG_OPINION_FLOOR = 50
// How much opinion a shared org adds per planning pass, up to the floor.
export const AI_ORG_OPINION_STEP = 1
// The AI offers subjection to a neighbour it is this much stronger than (on top
// of the base ratio rule in subjectData) and at peace with.
export const AI_SUBJUGATE_OPINION = 0
// A nation escalates its own skirmish to a limited war when it is winning it by
// at least this war score.
export const AI_ESCALATE_SCORE = 20
