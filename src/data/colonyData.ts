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
// it is built, and the new colony's starting population.
export const COLONY_SHIP_SETTLERS = 20
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
