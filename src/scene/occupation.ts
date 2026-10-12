// Occupation, blockade and what a change of control changes (docs/territorial-design.md M11). Nothing is stored:
// these read the layers the game already keeps and set them side by side, so the player and the AI can see
// what moved and what did not when a war, a treaty or an occupation changes who holds a place.
//   sovereign   who governs it (claims, bodyOwner)       changes only by treaty or transfer
//   controller  who holds the ground by force            changes by invasion and liberation
//   orbit       who holds the orbit by force             changes with the fleets
//   property    who owns the sites, facilities, routes   never changes by any of the above
import { useInfrastructureStore } from '../state/infrastructureStore'
import { siteOwner, useLocationStore } from '../state/locationStore'
import { useOrbitalStore } from '../state/orbitalStore'
import { useTerritoryStore } from '../state/territoryStore'
import { jurisdictionNow } from './sovereignty'
import { orbitalControlNow } from './orbitalState'
import { bodyOfZone } from './orbits'

export interface ControlSnapshot {
  bodyName: string
  sovereign?: string
  controller?: string
  orbitController?: string
  // Site / facility / route id -> owner.
  property: Record<string, string>
}

export function controlSnapshot(bodyName: string): ControlSnapshot {
  const territory = useTerritoryStore.getState()
  const property: Record<string, string> = {}
  for (const id of Object.keys(useLocationStore.getState().established).filter((s) => s.startsWith(`${bodyName}#`))) {
    const owner = siteOwner(id)
    if (owner) property[id] = owner
  }
  for (const f of useOrbitalStore.getState().facilities) if (bodyOfZone(f.zone) === bodyName) property[f.id] = f.ownerId
  for (const r of useInfrastructureStore.getState().routes) if (r.bodyName === bodyName) property[r.id] = r.ownerId
  return {
    bodyName,
    sovereign: jurisdictionNow({ kind: 'body', id: bodyName }).sovereign,
    controller: territory.bodyController[bodyName] ?? territory.bodyOwner[bodyName],
    orbitController: orbitalControlNow(bodyName).controller,
    property,
  }
}

export interface ControlChange {
  // What is different now, in words.
  changed: string[]
  // What stayed exactly as it was.
  unchanged: string[]
}

// What a change of control changed and what it did not (the "Changes of control" panel): never a silent transfer
// of everything. Pure over two snapshots.
export function describeControlChange(before: ControlSnapshot, after: ControlSnapshot, nameOf: (id: string) => string = (id) => id): ControlChange {
  const changed: string[] = []
  const unchanged: string[] = []
  const who = (id?: string) => (id ? nameOf(id) : 'nobody')
  const layer = (label: string, a?: string, b?: string) => (a === b ? unchanged.push(`${label}: still ${who(a)}`) : changed.push(`${label}: ${who(a)} -> ${who(b)}`))
  layer('Sovereignty', before.sovereign, after.sovereign)
  layer('Ground control', before.controller, after.controller)
  layer('Orbital control', before.orbitController, after.orbitController)
  const moved = Object.keys({ ...before.property, ...after.property }).filter((id) => before.property[id] !== after.property[id])
  if (moved.length === 0) unchanged.push(`Property: all ${Object.keys(before.property).length} holdings keep their owners`)
  else for (const id of moved) changed.push(`Property ${id}: ${who(before.property[id])} -> ${who(after.property[id])}`)
  return { changed, unchanged }
}
