import { create } from 'zustand'
import type { FleetTab } from '../components/FleetManagement'

// Buttons the player keeps in the navigation bar for panels they use a lot.
// One is there from the start (Shipyard); "+ Pin this panel" adds the panel
// that is open, right-click removes a pinned one. Kept for the session, like
// window sizes (it is a layout choice, not game state).
export interface CustomButton {
  id: string
  label: string
  category: string
  subcategory: string | null
  // For Fleet Management > Navy: which of its tabs to land on.
  fleetTab?: FleetTab
  // The default button: can't be removed.
  builtin?: boolean
}

export const DEFAULT_CUSTOM_BUTTONS: CustomButton[] = [
  { id: 'shipyard', label: 'Shipyard', category: 'Fleet Management', subcategory: 'Navy', fleetTab: 'shipyard', builtin: true },
]

interface CustomButtonStore {
  buttons: CustomButton[]
  // Pin a panel; returns false if it is already pinned.
  pin: (category: string, subcategory: string | null) => boolean
  remove: (id: string) => void
}

export const useCustomButtonStore = create<CustomButtonStore>((set, get) => ({
  buttons: DEFAULT_CUSTOM_BUTTONS,
  pin: (category, subcategory) => {
    if (get().buttons.some((b) => b.category === category && b.subcategory === subcategory && !b.fleetTab)) return false
    const label = subcategory && subcategory !== category ? subcategory : category
    set((s) => ({ buttons: [...s.buttons, { id: `pin:${category}:${subcategory ?? ''}`, label, category, subcategory }] }))
    return true
  },
  remove: (id) => set((s) => ({ buttons: s.buttons.filter((b) => b.id !== id || b.builtin) })),
}))
