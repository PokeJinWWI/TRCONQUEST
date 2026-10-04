import { create } from 'zustand'
import type { FleetTab } from '../components/FleetManagement'

// Which tab of Military > Navy is showing (Fleet Manager, Ship Designer,
// Shipyard…). A store rather than the panel's own state so the shipyard icon
// on a map, and the quick buttons, can open the panel straight on a tab.
//
// The Shipyard's own subtab (Warships, Science & support, Slips…) stays the panel's
// local state; these two fields only carry it across: `shipyardNow` is what it shows
// (written by the panel, read when a quick button is pinned) and `shipyardRequest` is a
// one-shot ask for a subtab (a quick button), taken by the panel when it opens or
// while it is open, then cleared.
export const useFleetTabStore = create<{
  tab: FleetTab
  setTab: (tab: FleetTab) => void
  shipyardNow: string | null
  setShipyardNow: (id: string | null) => void
  shipyardRequest: string | null
  requestShipyardTab: (id: string | null) => void
}>((set) => ({
  tab: 'manager',
  setTab: (tab) => set({ tab }),
  shipyardNow: null,
  setShipyardNow: (shipyardNow) => set({ shipyardNow }),
  shipyardRequest: null,
  requestShipyardTab: (shipyardRequest) => set({ shipyardRequest }),
}))

// The Navy tab to show when the player picks a nav category/subtab (NOT a quick button or a
// shipyard icon, which name their own tab). Entering Navy from anywhere else opens on Fleet
// Manager (the first tab); clicking Navy while already on it leaves the tab as it is. Without
// this the store kept whatever tab was used last, so Navy could open on the Shipyard.
export function navyTabOnOpen(from: { category: string | null; subcategory: string | null }, to: { category: string | null; subcategory: string | null }, current: FleetTab): FleetTab {
  const isNavy = (p: { category: string | null; subcategory: string | null }) => p.category === 'Fleet Management' && p.subcategory === 'Navy'
  return isNavy(to) && !isNavy(from) ? 'manager' : current
}
