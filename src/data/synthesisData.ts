// Hyperium Synthesis: turning exotic matter into hyperium. Pure constants with no
// imports, so the Simple economy's data, the tech tree and the monthly step can
// all read them without a cycle. See scene/extraction.ts for the Complex step and
// data/simplisticEconomyData.ts for the Simple building.
//
// Lore: hyperium cannot be made from nothing. Researching Synthesis needs a stock
// of hyperium to HOLD (a seed to work from, never consumed), and the process itself
// burns exotic matter, which is as finite as hyperium is.

export const HYPERIUM_SYNTHESIS_TECH_ID = 'hyperium-synthesis'
// Hyperium a nation must hold (not spend) to research Hyperium Synthesis.
export const HYPERIUM_SYNTHESIS_HOLD = 5
// Exotic matter burned per hyperium made, the one tunable conversion rate.
export const EXOTIC_PER_HYPERIUM = 3
// Hyperium one refinery level makes a month (Simple's Hyperium Refinery building;
// it eats HYPERIUM_PER_REFINERY * EXOTIC_PER_HYPERIUM exotic matter a month).
export const HYPERIUM_PER_REFINERY = 0.5
// Complex mode has no such building, so a nation there refines like this many
// refinery levels (what Mars had in Simple) once it has researched Synthesis.
export const COMPLEX_REFINERY_LEVELS = 2
