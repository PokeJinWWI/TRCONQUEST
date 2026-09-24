import { getCountry } from './countryData'

// Which nations take part in which strategic systems. Data-only.
//
// Every country in countryData.COUNTRIES is a real nation: it owns ships,
// territory, resources and a shipyard, and can be at war. What differs is who
// DRIVES it when the player isn't: the three demo empires below run the
// strategic AI (src/ai/); anything else (today, the Kingdom of Lalande) is
// playable but dormant — no AI empire runs it, and AI empires never pick it as
// a war target, until it gets its own treatment later.
export const STRATEGIC_AI_COUNTRY_IDS: readonly string[] = ['imperial-state-of-mars', 'republic-of-venus', 'orion-republic']

// Whether the strategic AI should drive `countryId` right now — never the
// player's own nation, and never a dormant one.
export function runsStrategicAI(countryId: string, playerCountryId: string | null): boolean {
  return countryId !== playerCountryId && STRATEGIC_AI_COUNTRY_IDS.includes(countryId)
}

// Whether an AI empire may target `countryId` with a war declaration. A
// dormant nation is left alone unless it's the player's (a player choosing
// Lalande can still be attacked — they're a real opponent then).
export function isValidAiWarTarget(countryId: string, playerCountryId: string | null): boolean {
  return countryId === playerCountryId || STRATEGIC_AI_COUNTRY_IDS.includes(countryId)
}

// --- No-nation factions ------------------------------------------------------
//
// Owners that aren't nations: spawnable from the debug console for testing
// fights without starting a war. They own ships and armies like anyone else,
// but have no territory, economy, diplomacy or AI, and nobody commands them.
// Their hostility is fixed (see diplomacyStore.rogueHostility) rather than
// stored as wars, so they never show up in the Diplomacy panel, war score or
// peace terms:
//   Pirates              at war with everyone (every nation and the friendlies)
//   Friendly Irregulars  at war only with pirates; shown to the player as Allied
export const PIRATES_ID = 'rogue-pirates'
export const FRIENDLY_ROGUE_ID = 'rogue-friendly'

export interface RogueFaction {
  id: string
  name: string
  color: string
}

export const ROGUE_FACTIONS: readonly RogueFaction[] = [
  { id: PIRATES_ID, name: 'Pirates', color: '#ff7a3d' },
  { id: FRIENDLY_ROGUE_ID, name: 'Friendly Irregulars', color: '#5ab0ff' },
]

export function isRogueFaction(id: string): boolean {
  return id === PIRATES_ID || id === FRIENDLY_ROGUE_ID
}

// Display name and colour for any owner — a nation or a no-nation faction.
export function ownerDisplay(id: string): { name: string; color: string } {
  const country = getCountry(id)
  if (country) return { name: country.name, color: country.color }
  const rogue = ROGUE_FACTIONS.find((r) => r.id === id)
  if (rogue) return { name: rogue.name, color: rogue.color }
  return { name: id, color: '#9aa4b2' }
}
