import { create } from 'zustand'
import type { FleetAllegiance } from '../data/shipData'
import type { FleetStrategy } from '../data/combatData'

// A fleet is purely a name, an allegiance, and (optionally) a standing
// coordinated strategy — which ships belong to it lives on the ships
// themselves (ShipInstance.fleetId), not here, so moving a ship between
// fleets is a one-field write on that ship rather than a two-sided sync
// between a fleet's roster and the ship's own record. Every ship always
// belongs to exactly one fleet, even a lone hull fresh out of a shipyard —
// a "fleet" of one is the common case, not a special one; see
// shipStore.spawnShip and setShipLocation for how a ship picks (or is
// assigned) its fleet.
export interface Fleet {
  id: string
  name: string
  allegiance: FleetAllegiance
  // Null means no fleet-wide order is active — every member just follows
  // its own individual stance, same as before fleets could coordinate at
  // all. Set via shipStore.setFleetStrategy, which is also what keeps this
  // in lockstep with every current member's ShipInstance.stance (see
  // combatData.CombatStance's 'fleet' sentinel) — never write this field
  // directly from anywhere else, or a member's stance and its fleet's own
  // idea of "are we coordinating" can disagree.
  strategy: FleetStrategy | null
}

// 1st, 2nd, 3rd, 4th, ... 11th, 12th, 13th, 21st — standard ordinal suffix.
function ordinal(n: number): string {
  const j = n % 10
  const k = n % 100
  if (j === 1 && k !== 11) return `${n}st`
  if (j === 2 && k !== 12) return `${n}nd`
  if (j === 3 && k !== 13) return `${n}rd`
  return `${n}th`
}

// A fresh fleet's default name — Stellaris-style, numbered per allegiance
// (a player's 1st Fleet and a hostile's 1st Fleet are unrelated counters).
// Based on how many fleets that allegiance currently has, so the number can
// repeat after an earlier fleet is merged away or wiped out — cosmetic, not
// a stable identifier (id is), so that's an acceptable quirk rather than a
// reason to keep a separate monotonic counter around.
export function nextFleetName(existing: Fleet[], allegiance: FleetAllegiance): string {
  const count = existing.filter((f) => f.allegiance === allegiance).length
  return `${ordinal(count + 1)} Fleet`
}

interface FleetState {
  fleets: Fleet[]
  createFleet: (fleet: Fleet) => void
  renameFleet: (id: string, name: string) => void
  // A fleet with no ships left in it (its last member died, moved to
  // another fleet via a merge, or was removed) has nothing to show in any
  // list — pruned rather than left to accumulate as dead entries. Called
  // from shipStore wherever a ship's fleetId changes or a ship is removed,
  // not from here (this store has no visibility into ship state at all).
  removeFleet: (id: string) => void
  // Sets or clears (pass null) this fleet's own idea of its strategy. Only
  // ever called from shipStore.setFleetStrategy, which pairs it with the
  // matching bulk update to every member's own stance — see Fleet.strategy's
  // own comment for why this needs to stay paired rather than being called
  // directly.
  setStrategy: (id: string, strategy: FleetStrategy | null) => void
}

export const useFleetStore = create<FleetState>((set) => ({
  fleets: [],
  createFleet: (fleet) => set((s) => ({ fleets: [...s.fleets, fleet] })),
  renameFleet: (id, name) => set((s) => ({ fleets: s.fleets.map((f) => (f.id === id ? { ...f, name } : f)) })),
  removeFleet: (id) => set((s) => ({ fleets: s.fleets.filter((f) => f.id !== id) })),
  setStrategy: (id, strategy) => set((s) => ({ fleets: s.fleets.map((f) => (f.id === id ? { ...f, strategy } : f)) })),
}))
