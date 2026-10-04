import { create } from 'zustand'
import { newDeconstruction, type ShipDeconstruction } from '../scene/shipDeconstruction'
import type { ShipClass } from '../data/shipData'

// Ships being scrapped, by ship (scene/shipDeconstruction.ts: a draining bar, no slip).
interface ShipDeconstructionState {
  jobs: ShipDeconstruction[]
  begin: (ship: { id: string; ownerId: string; name: string }, shipClass: ShipClass, simDays: number) => void
  cancel: (shipId: string) => void
  setJobs: (jobs: ShipDeconstruction[]) => void
}

export const useShipDeconstructionStore = create<ShipDeconstructionState>((set) => ({
  jobs: [],
  begin: (ship, shipClass, simDays) => set((s) => (s.jobs.some((j) => j.shipId === ship.id) ? s : { jobs: [...s.jobs, newDeconstruction(ship, shipClass, simDays)] })),
  cancel: (shipId) => set((s) => ({ jobs: s.jobs.filter((j) => j.shipId !== shipId) })),
  setJobs: (jobs) => set({ jobs }),
}))
