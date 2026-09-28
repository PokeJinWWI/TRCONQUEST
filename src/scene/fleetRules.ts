// Who may be in a fleet. A fleet is something the PLAYER builds (merge/split in
// the ship panel) — ships never join one on their own — and only ships that
// fight or carry troops can be in one: science, construction and cargo hulls
// and every other civilian travel alone.
import { resolveShipClass } from '../state/shipClassResolver'

const CIVILIAN_ROLES = new Set(['civilian', 'science', 'construction', 'cargo'])

export function isCivilianClass(classId: string): boolean {
  const role = resolveShipClass(classId)?.role
  return !!role && CIVILIAN_ROLES.has(role)
}

// Whether any of these ships is a civilian (and so keeps a fleet from merging).
export function anyCivilian(ships: { classId: string }[]): boolean {
  return ships.some((s) => isCivilianClass(s.classId))
}
