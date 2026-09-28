// Who may be in a fleet. A fleet is something the PLAYER builds (merge/split in
// the ship panel) — ships never join one on their own — and only ships that
// fight or carry troops can be in one: science, construction and cargo hulls
// and every other civilian travel alone.
import { combatLocationKey } from '../state/combatStore'
import { resolveShipClass } from '../state/shipClassResolver'
import type { ShipInstance } from '../state/shipStore'

const CIVILIAN_ROLES = new Set(['civilian', 'science', 'construction', 'cargo'])

export function isCivilianClass(classId: string): boolean {
  const role = resolveShipClass(classId)?.role
  return !!role && CIVILIAN_ROLES.has(role)
}

// Whether any of these ships is a civilian (and so keeps a fleet from merging).
export function anyCivilian(ships: { classId: string }[]): boolean {
  return ships.some((s) => isCivilianClass(s.classId))
}

// A fleet's single, unambiguous location — null when there isn't one (any
// member mid-transit, or members disagreeing on where "here" is), which is
// exactly when it's NOT safe to merge.
export function fleetLocationKey(members: ShipInstance[]): string | null {
  if (members.length === 0 || members.some((m) => m.order)) return null
  const key = combatLocationKey(members[0].location)
  if (key === null) return null
  return members.every((m) => combatLocationKey(m.location) === key) ? key : null
}

// Whether these fleets (each a list of its ships) can be merged into one, and
// if not, why in plain words. `isOwn` says which ships the player commands.
// Where they are doesn't matter: the others fly to the lead and join it there
// (scene/fleetMerge.ts).
export function mergeCheck(fleets: ShipInstance[][], isOwn: (ship: ShipInstance) => boolean): { ok: true } | { ok: false; reason: string } {
  if (fleets.length < 2) return { ok: false, reason: 'Select ships from at least two fleets' }
  const all = fleets.flat()
  if (!all.every(isOwn)) return { ok: false, reason: 'You can only merge your own ships' }
  if (anyCivilian(all)) return { ok: false, reason: 'Civilian ships travel alone and can’t join a fleet' }
  if (new Set(all.map((s) => s.ownerId)).size > 1) return { ok: false, reason: 'The ships must all belong to one nation' }
  return { ok: true }
}
