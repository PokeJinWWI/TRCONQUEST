// Territory: who owns which body, who currently CONTROLS it (occupation), and
// what that adds up to for a whole star system. Pure functions over plain
// ownership maps — see state/territoryStore.ts for the live state.
//
// Borders are per body (planet, dwarf planet, or moon): early on several
// nations share a system (Mars and Venus both live in Sol). A nation claims a
// WHOLE system only when it owns every body anyone owns there and nobody else
// holds one — unclaimed rocks don't block the claim (so Orion owns Alpha
// Centauri from the start, and Sol is contested between Mars and Venus).
//
// Ownership vs control: ownership changes only by treaty (a peace cession);
// control changes by force (an invasion — see scene/armyLogic.ts). An
// occupied body keeps its owner, and its system claim is still drawn from
// ownership; occupation is shown on top of that rather than redrawing
// borders mid-war.
import { PLANETS_BY_STAR, getPlanetsForStar } from './planetData'
import { getMoonsForPlanet } from './moonData'
import { generatedStarOfBody } from '../data/galaxyGen'

export type OwnerMap = Record<string, string>

export interface BodyInfo {
  name: string
  starId: string
  kind: 'planet' | 'moon'
  // For a moon, the planet it orbits.
  parentPlanet?: string
}

let bodyIndexCache: Map<string, BodyInfo> | null = null

// Every body in every charted system, by name — names are unique game-wide by
// construction (see planetData.ts), so this needs no system id to look up.
export function bodyIndex(): Map<string, BodyInfo> {
  if (bodyIndexCache) return bodyIndexCache
  const index = new Map<string, BodyInfo>()
  for (const [starId, planets] of Object.entries(PLANETS_BY_STAR)) {
    for (const planet of planets) {
      index.set(planet.name, { name: planet.name, starId, kind: 'planet' })
      for (const moon of getMoonsForPlanet(planet.name).moons) {
        index.set(moon.name, { name: moon.name, starId, kind: 'moon', parentPlanet: planet.name })
      }
    }
  }
  bodyIndexCache = index
  return index
}

// One body's entry: a hand-authored one from the index, or a generated planet of
// another cluster looked up on demand (data/galaxyGen.generatedStarOfBody, O(1)).
// bodyIndex() itself stays the Solar Neighbourhood's bodies, which is what the
// loops over "every body" run on; a generated body is reached by name only.
export function bodyInfoOf(bodyName: string): BodyInfo | undefined {
  const authored = bodyIndex().get(bodyName)
  if (authored) return authored
  const star = generatedStarOfBody(bodyName)
  return star ? { name: bodyName, starId: star.id, kind: 'planet' } : undefined
}

// Every body a nation owns, as entries: the Solar Neighbourhood's in index order,
// then any in other clusters (a colony founded there), by name.
export function ownedBodyInfos(countryId: string, owners: OwnerMap): BodyInfo[] {
  const index = bodyIndex()
  const home = [...index.values()].filter((b) => owners[b.name] === countryId)
  const abroad = Object.keys(owners)
    .filter((name) => owners[name] === countryId && !index.has(name))
    .sort()
    .map((name) => bodyInfoOf(name))
    .filter((b): b is BodyInfo => !!b)
  return [...home, ...abroad]
}

export function bodyStarId(bodyName: string): string | undefined {
  return bodyInfoOf(bodyName)?.starId
}

// Every body in one system — its planets/dwarfs and their moons.
export function systemBodies(starId: string): string[] {
  const names: string[] = []
  for (const planet of getPlanetsForStar(starId)) {
    names.push(planet.name)
    for (const moon of getMoonsForPlanet(planet.name).moons) names.push(moon.name)
  }
  return names
}

// The starting borders, straight from the authored body data.
export function seedBodyOwners(): OwnerMap {
  const owners: OwnerMap = {}
  for (const planets of Object.values(PLANETS_BY_STAR)) {
    for (const planet of planets) {
      if (planet.ownerId) owners[planet.name] = planet.ownerId
      for (const moon of getMoonsForPlanet(planet.name).moons) {
        if (moon.ownerId) owners[moon.name] = moon.ownerId
      }
    }
  }
  return owners
}

// Who actually holds a body right now — its occupier if it's occupied, its
// owner otherwise, undefined if nobody owns it.
export function controllerOf(bodyName: string, owners: OwnerMap, controllers: OwnerMap): string | undefined {
  return controllers[bodyName] ?? owners[bodyName]
}

export function isOccupied(bodyName: string, owners: OwnerMap, controllers: OwnerMap): boolean {
  const controller = controllers[bodyName]
  return !!controller && controller !== owners[bodyName]
}

export type SystemClaim =
  | { kind: 'owned'; countryId: string }
  | { kind: 'contested'; countryIds: string[] }
  | { kind: 'unclaimed' }

// A whole system's claim, from ownership (see this file's header for why
// occupation doesn't redraw it) plus, optionally, whoever holds a live
// Starbase there (scene/starbaseLogic.starbaseOwnersOf) — the one way a
// system with no colonized body can still be claimed. Every existing call
// site keeps working unchanged; only a caller that actually cares about
// Starbases needs to pass them.
export function systemClaim(starId: string, owners: OwnerMap, starbaseOwnerIds: string[] = []): SystemClaim {
  const present = new Set<string>()
  for (const body of systemBodies(starId)) {
    const owner = owners[body]
    if (owner) present.add(owner)
  }
  for (const owner of starbaseOwnerIds) present.add(owner)
  if (present.size === 0) return { kind: 'unclaimed' }
  if (present.size === 1) return { kind: 'owned', countryId: [...present][0] }
  return { kind: 'contested', countryIds: [...present].sort() }
}

// Every body a nation owns, and every one it currently controls.
export function bodiesOwnedBy(countryId: string, owners: OwnerMap): string[] {
  return Object.entries(owners)
    .filter(([, owner]) => owner === countryId)
    .map(([body]) => body)
}

export function bodiesControlledBy(countryId: string, owners: OwnerMap, controllers: OwnerMap): string[] {
  const bodies = new Set([...Object.keys(owners), ...Object.keys(controllers)])
  return [...bodies].filter((body) => controllerOf(body, owners, controllers) === countryId)
}
