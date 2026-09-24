// Ground armies: the formations a nation raises, what they're made of, and
// what they cost. An army is a FORMATION of typed units (battalions,
// brigades, regiments — see groundData.UNIT_TYPES); transports carry whole
// armies, but on the ground every unit is commanded on its own. Data only —
// see scene/armyLogic.ts, scene/groundResolution.ts. Every number here is a
// tuning pick, not a balance decision.
import type { ResourceCost } from './shipyardData'
import { UNIT_TYPES, type UnitType } from './groundData'

export type ArmyKind = 'assault' | 'garrison' | 'marine'

export interface ArmyKindSpec {
  id: ArmyKind
  name: string
  // The units a fresh formation of this kind is made of.
  units: UnitType[]
  // Only field armies board transports; garrisons stay put.
  canEmbark: boolean
  // Absent means this kind can't be recruited (garrisons are seeded at game
  // start and regenerate, they aren't bought).
  recruitCost?: ResourceCost
  recruitDays?: number
  description: string
}

export const ARMY_KINDS: Record<ArmyKind, ArmyKindSpec> = {
  assault: {
    id: 'assault',
    name: 'Assault Army',
    units: ['infantry', 'infantry', 'armour', 'artillery'],
    canEmbark: true,
    recruitCost: { minerals: 60, energy: 40, alloys: 10 },
    recruitDays: 20,
    description: 'Two infantry battalions, an armoured brigade and an artillery regiment.',
  },
  marine: {
    id: 'marine',
    name: 'Marine Army',
    units: ['marines', 'marines', 'marines', 'artillery'],
    canEmbark: true,
    recruitCost: { minerals: 80, energy: 50, alloys: 15 },
    recruitDays: 25,
    description: 'Three amphibious marine battalions and an artillery regiment — for island and ocean worlds.',
  },
  garrison: {
    id: 'garrison',
    name: 'Garrison',
    units: ['militia', 'militia'],
    canEmbark: false,
    description: 'Two militia units that hold their posts.',
  },
}

// A fresh formation's total strength (the sum of its units').
export function armyKindMaxStrength(kind: ArmyKind): number {
  return ARMY_KINDS[kind].units.reduce((sum, u) => sum + UNIT_TYPES[u].maxStrength, 0)
}

// Starting garrisons per owned body: a capital is fortified, an inhabited
// world defended, a bare rock gets a token force.
export const GARRISONS_AT_CAPITAL = 3
export const GARRISONS_AT_WORLD = 2
export const GARRISONS_AT_OUTPOST = 1

export function startingGarrisonCount(isCapital: boolean, isInhabited: boolean): number {
  if (isCapital) return GARRISONS_AT_CAPITAL
  if (isInhabited) return GARRISONS_AT_WORLD
  return GARRISONS_AT_OUTPOST
}

// Assault armies every nation starts with at its capital, ready to embark.
export const STARTING_ASSAULT_ARMIES = 2
