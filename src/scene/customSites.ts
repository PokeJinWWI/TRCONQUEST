// Sites the player (or an AI) FOUNDED by choosing ground, as opposed to the ones the generator finds. They live in
// state/locationStore (`custom`, saved); this module is the pure, import-light registry `locationsOf` reads, so
// scene/locations.ts needs no store. The store pushes every change here.
import type { DevLocation } from './locations'

let custom: Readonly<Record<string, readonly DevLocation[]>> = {}

export function setCustomSites(next: Readonly<Record<string, readonly DevLocation[]>>): void {
  custom = next
}

const NONE: readonly DevLocation[] = Object.freeze([])

export function customSitesOf(bodyName: string): readonly DevLocation[] {
  return custom[bodyName] ?? NONE
}

// Capacity overrides from redrawn zones (state/zoneStore): site id -> levels its zone holds, by body. A site never redrawn keeps
// the capacity it was generated with.
let zoneCapacities: Readonly<Record<string, Readonly<Record<string, number>>>> = {}
export const NO_ZONE_CAPS: Readonly<Record<string, number>> = Object.freeze({})

export function setZoneCapacities(next: Readonly<Record<string, Readonly<Record<string, number>>>>): void {
  zoneCapacities = next
}

export function zoneCapacitiesOf(bodyName: string): Readonly<Record<string, number>> {
  return zoneCapacities[bodyName] ?? NO_ZONE_CAPS
}
