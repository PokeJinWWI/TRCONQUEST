// Ship cargo: loading goods aboard at an owned world, moving them between two
// ships in the same place, and checking a hold against a cost. Pure functions
// over plain values — the stores are written by the callers (ShipPanel, the
// strategic AI's executor). Hold sizes live on the ship class
// (data/shipData.ts `cargoCapacity`).
//
// The units are simply "one unit of a good", summed over every good: a hold of
// 400 carries any mix of alloys/energy/exotic matter that adds up to 400.
import type { ResourceId } from '../data/resourceData'
import type { ResourceCost } from '../data/shipyardData'
import type { ShipLocation } from '../state/shipStore'
import { combatLocationKey } from '../state/combatStore'

export type Cargo = Partial<Record<ResourceId, number>>

export function cargoTotal(cargo: Cargo | undefined): number {
  let total = 0
  for (const n of Object.values(cargo ?? {})) total += n ?? 0
  return total
}

export function cargoSpace(capacity: number, cargo: Cargo | undefined): number {
  return Math.max(0, capacity - cargoTotal(cargo))
}

// Whether a hold covers a cost in full.
export function cargoCovers(cargo: Cargo | undefined, cost: ResourceCost): boolean {
  return (Object.entries(cost) as [ResourceId, number][]).every(([id, need]) => (cargo?.[id] ?? 0) >= need)
}

// A hold with `cost` taken out (never below zero).
export function cargoMinus(cargo: Cargo | undefined, cost: ResourceCost): Cargo {
  const out: Cargo = { ...(cargo ?? {}) }
  for (const [id, n] of Object.entries(cost) as [ResourceId, number][]) out[id] = Math.max(0, (out[id] ?? 0) - n)
  return out
}

export function cargoPlus(cargo: Cargo | undefined, add: ResourceCost): Cargo {
  const out: Cargo = { ...(cargo ?? {}) }
  for (const [id, n] of Object.entries(add) as [ResourceId, number][]) out[id] = (out[id] ?? 0) + n
  return out
}

// How much of `want` actually fits: each good is clamped to what `available`
// holds, and to the space left in the hold, taking the goods in the order
// asked. Whole units only.
export function clampToSpace(want: ResourceCost, available: Cargo, space: number): ResourceCost {
  const out: ResourceCost = {}
  let room = Math.floor(space)
  for (const [id, n] of Object.entries(want) as [ResourceId, number][]) {
    const take = Math.max(0, Math.min(Math.floor(n), Math.floor(available[id] ?? 0), room))
    if (take > 0) {
      out[id] = take
      room -= take
    }
  }
  return out
}

type LoadingShip = { ownerId: string; order: unknown; location: ShipLocation }

// Where a ship can be loaded: at rest in orbit of a body its own nation owns.
export function loadingBody(ship: LoadingShip, owners: Record<string, string>): { ok: true; bodyName: string } | { ok: false; reason: string } {
  if (ship.order) return { ok: false, reason: 'Under way: stop at an owned world to load' }
  if (ship.location.kind !== 'orbiting') return { ok: false, reason: 'Must be in orbit of one of your worlds' }
  if (owners[ship.location.bodyName] !== ship.ownerId) return { ok: false, reason: `${ship.location.bodyName} is not one of your worlds` }
  return { ok: true, bodyName: ship.location.bodyName }
}

// Whether two ships can hand goods across: same nation, both at rest in the
// same place.
export function transferCheck(from: LoadingShip & { id: string }, to: LoadingShip & { id: string }): { ok: true } | { ok: false; reason: string } {
  if (from.id === to.id) return { ok: false, reason: 'Pick another ship' }
  if (from.ownerId !== to.ownerId) return { ok: false, reason: 'Not the same nation' }
  if (from.order || to.order) return { ok: false, reason: 'Both ships must be at rest' }
  const a = combatLocationKey(from.location)
  if (!a || a !== combatLocationKey(to.location)) return { ok: false, reason: 'Ships must be in the same place' }
  return { ok: true }
}
