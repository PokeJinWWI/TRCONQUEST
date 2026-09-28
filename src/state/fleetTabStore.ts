import { create } from 'zustand'
import type { FleetTab } from '../components/FleetManagement'

// Which tab of Military > Navy is showing (Fleet Manager, Ship Designer,
// Shipyard…). A store rather than the panel's own state so the shipyard icon
// on a map can open the panel straight on its Shipyard tab.
export const useFleetTabStore = create<{ tab: FleetTab; setTab: (tab: FleetTab) => void }>((set) => ({
  tab: 'manager',
  setTab: (tab) => set({ tab }),
}))
