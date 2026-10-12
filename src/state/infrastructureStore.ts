import { create } from 'zustand'
import type { Route } from '../scene/infrastructureNet'

// The routes between development sites (scene/infrastructureNet.ts has the rules,
// scene/infrastructureOrders.ts the I/O). A route belongs to the country that built and
// runs it; its users are listed. Plain data, saved with the game.
interface InfrastructureStore {
  routes: Route[]
  // The month (simDays / 30, floored) upkeep was last paid for.
  maintainedMonth: number
  addRoute: (route: Route) => void
  removeRoute: (id: string) => void
  patchRoute: (id: string, patch: Partial<Route>) => void
  setMaintainedMonth: (month: number) => void
}

export const useInfrastructureStore = create<InfrastructureStore>((set) => ({
  routes: [],
  maintainedMonth: 0,
  addRoute: (route) => set((s) => ({ routes: [...s.routes, route] })),
  removeRoute: (id) => set((s) => ({ routes: s.routes.filter((r) => r.id !== id) })),
  patchRoute: (id, patch) => set((s) => ({ routes: s.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  setMaintainedMonth: (month) => set({ maintainedMonth: month }),
}))
