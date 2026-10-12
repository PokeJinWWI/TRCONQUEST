// Tuning for orbital zones and the facilities in them (scene/orbits.ts).
import type { GoodCost, ResourceCost } from './shipyardData'

export type OrbitalZoneKind = 'low' | 'high'
export const ORBITAL_ZONE_KINDS: OrbitalZoneKind[] = ['low', 'high']

// Facility slots a zone holds.
export const ZONE_SLOTS: Record<OrbitalZoneKind, number> = { low: 6, high: 4 }

export type FacilityKind = 'station' | 'shipyard' | 'defense' | 'hub'

export interface FacilitySpec {
  name: string
  // Slots it takes in its zone.
  slots: number
  // Armed strength it adds to its owner's hold on the orbit (ships add their weapons).
  power: number
  // The zones it can stand in.
  zones: OrbitalZoneKind[]
  goods: GoodCost
  resources: ResourceCost
}

export const FACILITY_SPECS: Record<FacilityKind, FacilitySpec> = {
  station: { name: 'Orbital Station', slots: 1, power: 0, zones: ['low', 'high'], goods: { steel: 30, tools: 10 }, resources: { alloys: 40 } },
  shipyard: { name: 'Orbital Shipyard', slots: 2, power: 0, zones: ['low'], goods: { steel: 80, tools: 30 }, resources: { alloys: 100 } },
  defense: { name: 'Defense Platform', slots: 1, power: 3, zones: ['low', 'high'], goods: { steel: 50, tools: 20 }, resources: { alloys: 70 } },
  hub: { name: 'Transfer Hub', slots: 1, power: 0, zones: ['high'], goods: { steel: 40, tools: 15 }, resources: { alloys: 60 } },
}

// A nation dominates an orbit when its armed strength is at least this many times that of the nations at war with it.
export const ORBIT_DOMINANCE_RATIO = 2
