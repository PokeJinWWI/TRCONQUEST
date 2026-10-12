import { create } from 'zustand'
import type { DefenseKind } from '../data/defenseData'
import type { RouteKind } from '../data/infrastructureData'

// The build lens (the ⚙ panel): what the player has picked up to place on the ground map, what the pointer would do with it, and the
// pulse that marks where something was just ordered. UI only, never saved.
export type LensTool =
  | { kind: 'building'; id: string; name: string }
  | { kind: 'level'; district: string; name: string }
  | { kind: 'defense'; defense: DefenseKind; name: string }
  | { kind: 'zone'; name: string }
  | { kind: 'reserve'; name: string }
  | { kind: 'route'; route: RouteKind; name: string }

export interface LensHover {
  node: number
  // The cells the click would act on, and whether it would work.
  cells: number[]
  ok: boolean
  text: string
}

export interface LensPulse {
  cells: number[]
  seq: number
  // Real time (ms) it started, for the animation.
  startedMs: number
  ok: boolean
}

interface LensStore {
  armed: LensTool | null
  // The district being redrawn by the zone tool (clicked first).
  zoneSiteId: string | null
  // The first end of a route being laid.
  routeFrom: string | null
  hover: LensHover | null
  pulse: LensPulse | null
  // The last click's outcome, shown beside the lens.
  message: { text: string; ok: boolean } | null
  brush: number
  arm: (tool: LensTool | null) => void
  setZoneSite: (siteId: string | null) => void
  setRouteFrom: (siteId: string | null) => void
  setHover: (hover: LensHover | null) => void
  firePulse: (cells: number[], ok: boolean) => void
  say: (text: string, ok: boolean) => void
  setBrush: (n: number) => void
}

export const useLensStore = create<LensStore>((set) => ({
  armed: null,
  zoneSiteId: null,
  routeFrom: null,
  hover: null,
  pulse: null,
  message: null,
  brush: 1,
  arm: (armed) => set({ armed, zoneSiteId: null, routeFrom: null, hover: null, message: null }),
  setZoneSite: (zoneSiteId) => set({ zoneSiteId }),
  setRouteFrom: (routeFrom) => set({ routeFrom }),
  setHover: (hover) => set({ hover }),
  firePulse: (cells, ok) => set((s) => ({ pulse: { cells, ok, seq: (s.pulse?.seq ?? 0) + 1, startedMs: Date.now() } })),
  say: (text, ok) => set({ message: { text, ok } }),
  setBrush: (brush) => set({ brush: Math.max(0, Math.min(6, Math.round(brush))) }),
}))
