// Ground war data: terrain, unit types, how each kind of world's surface is
// generated, and the tuning constants for the ground simulation (see
// scene/surfaceMesh.ts, scene/planetTerrain.ts, scene/groundResolution.ts).
// Data only. Every number is a tuning pick, not a balance decision.
//
// Scale: a surface node is a fixed share of a world (see surfaceMesh.ts), so
// distances are authored as km on an Earth-sized REFERENCE body and converted
// to an angle on the globe (km / GROUND_REFERENCE_RADIUS_KM). A range of 480
// "reference km" covers the same number of map cells on Phobos as on Venus —
// what "close enough on the map" has to mean — and the UI converts back to
// real km for the body being looked at. Speeds get a mild size factor on top
// (GROUND_SPEED_SIZE_EXPONENT) so a small moon still falls faster.
import type { PlanetClass } from '../scene/planetData'

// --- Terrain -----------------------------------------------------------------

export type TerrainId =
  | 'ocean'
  | 'plains'
  | 'forest'
  | 'desert'
  | 'tundra'
  | 'mountains'
  | 'urban'
  | 'rock'
  | 'lava'
  | 'cloud'
  | 'aerostat'

export interface TerrainSpec {
  id: TerrainId
  name: string
  // Hologram tint (dark, desaturated so nation colours read on top).
  tint: string
  // Who can stand here: everyone, only amphibious units, or nobody.
  passable: 'all' | 'amphibious' | 'none'
  // Multiplies travel time across this terrain (1 = open ground).
  moveCost: number
  // Divides damage taken by a unit standing here (1 = open ground).
  defense: number
  // Whether control of this node is shown/tracked (seas and clouds aren't
  // anyone's front line).
  paintable: boolean
}

export const TERRAIN: Record<TerrainId, TerrainSpec> = {
  ocean: { id: 'ocean', name: 'Ocean', tint: '#030c16', passable: 'amphibious', moveCost: 2, defense: 0.8, paintable: false },
  plains: { id: 'plains', name: 'Plains', tint: '#5a7a4a', passable: 'all', moveCost: 1, defense: 1, paintable: true },
  forest: { id: 'forest', name: 'Forest', tint: '#2f5a34', passable: 'all', moveCost: 1.5, defense: 1.25, paintable: true },
  desert: { id: 'desert', name: 'Desert', tint: '#8a744a', passable: 'all', moveCost: 1.2, defense: 0.95, paintable: true },
  tundra: { id: 'tundra', name: 'Tundra / Ice', tint: '#8a9aa8', passable: 'all', moveCost: 1.4, defense: 1.05, paintable: true },
  mountains: { id: 'mountains', name: 'Mountains', tint: '#7a7470', passable: 'all', moveCost: 2.5, defense: 1.5, paintable: true },
  urban: { id: 'urban', name: 'Urban', tint: '#a0a0ae', passable: 'all', moveCost: 1.3, defense: 1.4, paintable: true },
  rock: { id: 'rock', name: 'Barren Rock', tint: '#66605a', passable: 'all', moveCost: 1.1, defense: 1, paintable: true },
  lava: { id: 'lava', name: 'Lava', tint: '#5a1a0a', passable: 'none', moveCost: 99, defense: 1, paintable: false },
  cloud: { id: 'cloud', name: 'Cloud Deck', tint: '#3a3f55', passable: 'none', moveCost: 99, defense: 1, paintable: false },
  aerostat: { id: 'aerostat', name: 'Aerostat Platforms', tint: '#6a6f8a', passable: 'all', moveCost: 1.6, defense: 1.2, paintable: true },
}

// --- Units -------------------------------------------------------------------

export type UnitType = 'infantry' | 'armour' | 'artillery' | 'marines' | 'militia'

export interface TerrainMod {
  speed?: number
  attack?: number
  defense?: number
  impassable?: boolean
}

export interface UnitTypeSpec {
  id: UnitType
  name: string
  // Map glyph.
  glyph: string
  // How many people one full-strength unit stands for (a battalion or
  // brigade, not a single soldier).
  personnel: number
  maxStrength: number
  attack: number
  defense: number
  speedKmPerDayRef: number
  rangeKmRef: number
  // Can cross ocean (slowly).
  amphibious: boolean
  // Never moves on its own or under orders (a garrison militia).
  holdsPosition: boolean
  terrain: Partial<Record<TerrainId, TerrainMod>>
  description: string
}

// Every line unit shares one contact range, so no line unit can outrange
// ("kite") another; only artillery reaches further. About one fine map cell
// (a fine cell is ~440 reference km), so units on neighbouring nodes are in
// contact and units two nodes apart aren't.
export const CONTACT_RANGE_KM_REF = 480

export const UNIT_TYPES: Record<UnitType, UnitTypeSpec> = {
  infantry: {
    id: 'infantry',
    name: 'Infantry Battalion',
    glyph: '▲',
    personnel: 4000,
    maxStrength: 25,
    attack: 1.0,
    defense: 1.0,
    speedKmPerDayRef: 150,
    rangeKmRef: CONTACT_RANGE_KM_REF,
    amphibious: false,
    holdsPosition: false,
    terrain: { forest: { defense: 1.2 }, urban: { defense: 1.2 }, mountains: { defense: 1.2 } },
    description: 'The line. Holds rough ground well.',
  },
  armour: {
    id: 'armour',
    name: 'Armoured Brigade',
    glyph: '◆',
    personnel: 1200,
    maxStrength: 25,
    attack: 1.4,
    defense: 1.1,
    speedKmPerDayRef: 300,
    rangeKmRef: CONTACT_RANGE_KM_REF,
    amphibious: false,
    holdsPosition: false,
    terrain: {
      plains: { attack: 1.2 },
      desert: { attack: 1.2 },
      forest: { speed: 0.5 },
      urban: { speed: 0.5 },
      mountains: { impassable: true },
    },
    description: 'Fast and hard-hitting in the open; slowed by forest and cities, and can\'t cross mountains.',
  },
  artillery: {
    id: 'artillery',
    name: 'Artillery Regiment',
    glyph: '✚',
    personnel: 1500,
    maxStrength: 25,
    attack: 1.2,
    defense: 0.6,
    speedKmPerDayRef: 120,
    rangeKmRef: 900,
    amphibious: false,
    holdsPosition: false,
    terrain: {},
    description: 'Strikes from well beyond the line; fragile if caught.',
  },
  marines: {
    id: 'marines',
    name: 'Marine Battalion',
    glyph: '⚓',
    personnel: 2500,
    maxStrength: 25,
    attack: 1.0,
    defense: 1.0,
    speedKmPerDayRef: 150,
    rangeKmRef: CONTACT_RANGE_KM_REF,
    amphibious: true,
    holdsPosition: false,
    terrain: { ocean: { speed: 0.5 } },
    description: 'Amphibious: can cross oceans, at half speed.',
  },
  militia: {
    id: 'militia',
    name: 'Garrison Militia',
    glyph: '■',
    personnel: 5000,
    maxStrength: 40,
    attack: 0.6,
    defense: 1.25,
    speedKmPerDayRef: 100,
    rangeKmRef: CONTACT_RANGE_KM_REF,
    amphibious: false,
    holdsPosition: true,
    terrain: { urban: { defense: 1.3 } },
    description: 'Static defenders. Never leave their post; strongest in cities.',
  },
}

// --- Surfaces ----------------------------------------------------------------

export interface SurfaceClassSpec {
  // Exact share of the surface that is land (set by elevation percentile).
  landFraction: number
  // What the non-land share is.
  seaTerrain: 'ocean' | 'lava' | 'cloud'
  // Default land terrain before biomes.
  landBase: TerrainId
  // Share of land that is mountains (the highest).
  mountainFraction: number
  // |latitude| (sine) above which land is tundra/ice. >1 disables.
  iceLatitude: number
  // Moisture thresholds (0..1): above forest → forest, below desert → desert.
  forestMoisture: number
  desertMoisture: number
  // Weight of the low-frequency "continent" noise (clumps land together).
  continentBias: number
  // Gas/ice giants: the half-width (sine of latitude) of the aerostat belt;
  // everything else is cloud.
  belt?: number
  // Tidally locked "eyeball" world: hot desert day side, ice night side.
  eyeball?: boolean
}

export const SURFACE_CLASSES: Record<PlanetClass, SurfaceClassSpec> = {
  continental: { landFraction: 0.35, seaTerrain: 'ocean', landBase: 'plains', mountainFraction: 0.15, iceLatitude: 0.85, forestMoisture: 0.58, desertMoisture: 0.35, continentBias: 1.2 },
  ocean: { landFraction: 0.3, seaTerrain: 'ocean', landBase: 'plains', mountainFraction: 0.12, iceLatitude: 0.9, forestMoisture: 0.5, desertMoisture: 0.25, continentBias: 1.4 },
  hycean: { landFraction: 0.12, seaTerrain: 'ocean', landBase: 'plains', mountainFraction: 0.1, iceLatitude: 0.95, forestMoisture: 0.45, desertMoisture: 0.2, continentBias: 1.6 },
  desert: { landFraction: 0.92, seaTerrain: 'ocean', landBase: 'desert', mountainFraction: 0.18, iceLatitude: 0.92, forestMoisture: 2, desertMoisture: 2, continentBias: 0.6 },
  toxic: { landFraction: 0.75, seaTerrain: 'ocean', landBase: 'rock', mountainFraction: 0.18, iceLatitude: 2, forestMoisture: 2, desertMoisture: 0.5, continentBias: 0.8 },
  barren: { landFraction: 1, seaTerrain: 'ocean', landBase: 'rock', mountainFraction: 0.2, iceLatitude: 2, forestMoisture: 2, desertMoisture: -1, continentBias: 0.5 },
  ice: { landFraction: 1, seaTerrain: 'ocean', landBase: 'tundra', mountainFraction: 0.18, iceLatitude: 0, forestMoisture: 2, desertMoisture: -1, continentBias: 0.5 },
  lava: { landFraction: 0.55, seaTerrain: 'lava', landBase: 'rock', mountainFraction: 0.2, iceLatitude: 2, forestMoisture: 2, desertMoisture: -1, continentBias: 1.0 },
  eyeball: { landFraction: 0.5, seaTerrain: 'ocean', landBase: 'plains', mountainFraction: 0.12, iceLatitude: 2, forestMoisture: 0.55, desertMoisture: 0.3, continentBias: 1.0, eyeball: true },
  'gas-giant': { landFraction: 0, seaTerrain: 'cloud', landBase: 'aerostat', mountainFraction: 0, iceLatitude: 2, forestMoisture: 2, desertMoisture: -1, continentBias: 0, belt: 0.14 },
  'ice-giant': { landFraction: 0, seaTerrain: 'cloud', landBase: 'aerostat', mountainFraction: 0, iceLatitude: 2, forestMoisture: 2, desertMoisture: -1, continentBias: 0, belt: 0.14 },
}

// The largest landmass must cover at least this share of the surface; if the
// noise leaves it smaller, sea level drops until it does (so every inhabited
// world can be invaded on foot).
export const MIN_MAINLAND_FRACTION = 0.08

// --- Key nodes ---------------------------------------------------------------

// Cities on an inhabited world, by its district count (bodyStats.estimateSize).
export function citiesForDistricts(districts: number): number {
  return Math.max(1, Math.min(4, Math.round(districts / 6)))
}
// Key nodes keep at least this many fine cells apart.
export const KEY_MIN_SEPARATION_CELLS = 5

// --- Simulation --------------------------------------------------------------

export const GROUND_REFERENCE_RADIUS_KM = 6371
export const GROUND_SPEED_SIZE_EXPONENT = 0.25
export const GROUND_SPEED_FACTOR_MIN = 0.6
export const GROUND_SPEED_FACTOR_MAX = 2.5
// The ground clock: an integer step count, 16 per sim-day.
export const GROUND_STEPS_PER_DAY = 16
// Autonomous (AI) units rethink once per sim-day.
export const GROUND_AI_INTERVAL_STEPS = 16
// Most steps one resolver call will run (a huge clock jump catches up over
// several frames rather than stalling one).
export const MAX_GROUND_STEPS_PER_CALL = 4096

// Fraction of attack power that lands as damage per day.
export const GROUND_DAMAGE_RATE = 0.08
export const UNIT_DESTROYED_BELOW = 0.5
// Strength recovered per day (share of max) resting on own-held ground.
export const UNIT_REGEN_PER_DAY = 0.02
// A unit standing still this long (days) is dug in.
export const ENTRENCH_AFTER_DAYS = 2
export const ENTRENCHMENT_DEFENSE = 1.15
// Defending a key node its nation holds.
export const KEY_NODE_FORTIFICATION = 1.25

// Radii in fine-grid cells (see surfaceMesh.fineSpacingRad).
export const CAPTURE_RADIUS_CELLS = 0.75
export const KEY_HOLD_RADIUS_CELLS = 0.75
// A drop can't be made this close to a hostile unit (beyond line contact
// range, so an invasion never lands already in a fight).
export const DROP_EXCLUSION_CELLS = 2.5
// Landed units spread around the drop node within this many cells.
export const DROP_SPREAD_CELLS = 1
