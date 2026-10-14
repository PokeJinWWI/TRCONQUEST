// Colonies and Influence (scene/colonies.ts, state/colonyStore.ts). Version 1:
// a colony claims its whole planet for its nation; shared planets come later
// (docs/colonies-design.md). Every number here is a tuning pick.

// Influence: a national stockpile, spent on claiming systems with Starbases (founding a
// colony costs none).
export const INFLUENCE_CAP = 1000
export const INFLUENCE_PER_MONTH = 2
// Enough for a first colony close to home early on.
export const STARTING_INFLUENCE = 100

// Settlers (millions) a Colony Ship takes from its capital's population when
// it is built (real pops from a chosen world: economy/settlerPicker.ts), and the new colony's starting population.
export const COLONY_SHIP_SETTLERS = 3
// A world never gives settlers below this (millions).
export const SETTLER_SOURCE_FLOOR = 50

// Days a Colony Ship spends in orbit founding a colony (landing the settlers
// and building the outpost) before the colony exists. Leaving, or losing the
// orbit to enemy warships, abandons the attempt.
export const COLONY_FOUNDING_DAYS = 60

// A micro-colony's district levels, until it becomes a planetary colony.
export const MICRO_COLONY_LAND = 3
// Days the colony's orbit must be held by the owner's patrol ships, with no
// hostile warship there, before a micro-colony becomes a planetary colony.
export const COLONY_PATROL_DAYS = 90

// A new colony's landing is an OUTPOST (a small civic building); once the settlement holds this many millions of people it
// becomes a municipal hall (scene/civic.ts), automatically.
export const OUTPOST_HALL_POPULATION = 5

// Claiming a whole planet (scene/planetClaim.ts): a lot of Influence, more for a bigger world. A claim on its own is a
// provisional one (it reserves the world: nobody else may found a colony there); with this many millions of your people on the
// world it is recognized at once and the whole planet is yours.
export const CLAIM_PLANET_INFLUENCE_BASE = 60
export const CLAIM_PLANET_INFLUENCE_PER_LAND = 2
export const CLAIM_PLANET_MIN_POPULATION = 5

// A new Complex colony starts with the buildings a colony of this many millions would run (economy/colonySeed.ts), however few
// settlers actually came: the old 20-million ship's colony, now staffed by the few who landed and growing into it.
export const COLONY_KIT_POPULATION = 20
