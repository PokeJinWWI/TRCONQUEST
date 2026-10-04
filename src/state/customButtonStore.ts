import { create } from 'zustand'
import type { FleetTab } from '../components/FleetManagement'

// Buttons the player keeps in the navigation bar for panels they use a lot.
// One is there from the start (Shipyard); "+ Pin this panel" adds the panel
// that is open, with the inner tab it is on; the x (or a right-click) removes a
// pinned one. Kept for the session, like window sizes (it is a layout choice, not
// game state).
export interface CustomButton {
  id: string
  label: string
  category: string
  subcategory: string | null
  // For Fleet Management > Navy: which of its tabs to land on. Absent: the default.
  fleetTab?: FleetTab
  // For the Shipyard tab: which of its subtabs (the hull groups, Slips). Absent: the first.
  shipyardTab?: string
  // The default button: can't be removed.
  builtin?: boolean
}

export const DEFAULT_CUSTOM_BUTTONS: CustomButton[] = [
  { id: 'shipyard', label: 'Shipyard', category: 'Fleet Management', subcategory: 'Navy', fleetTab: 'shipyard', builtin: true },
]

export const DEFAULT_FLEET_TAB: FleetTab = 'manager'

// The inner tabs a panel shows right now, as a button saves them.
export interface InnerTabs {
  fleetTab?: FleetTab
  shipyardTab?: string | null
}

const NAVY = { category: 'Fleet Management', subcategory: 'Navy' }
const isNavy = (category: string, subcategory: string | null) => category === NAVY.category && subcategory === NAVY.subcategory

// The inner tabs a button saves when pinned from `category`/`subcategory`: only the Navy
// panel has any, and the Shipyard's subtab only counts while the Shipyard tab is open.
export function innerTabsToSave(category: string, subcategory: string | null, now: InnerTabs): Pick<CustomButton, 'fleetTab' | 'shipyardTab'> {
  if (!isNavy(category, subcategory) || !now.fleetTab) return {}
  return { fleetTab: now.fleetTab, ...(now.fleetTab === 'shipyard' && now.shipyardTab ? { shipyardTab: now.shipyardTab } : {}) }
}

// Where a button lands in the Navy panel: its saved tabs, else the defaults (a button
// saved before inner tabs existed opens the panel's first tab). Null for any other panel.
export function landingTabs(b: Pick<CustomButton, 'category' | 'subcategory' | 'fleetTab' | 'shipyardTab'>): { fleetTab: FleetTab; shipyardTab: string | null } | null {
  if (!isNavy(b.category, b.subcategory)) return null
  return { fleetTab: b.fleetTab ?? DEFAULT_FLEET_TAB, shipyardTab: b.fleetTab === 'shipyard' ? b.shipyardTab ?? null : null }
}

// Whether the same panel on the same inner tabs is already pinned.
export function samePin(b: CustomButton, category: string, subcategory: string | null, inner: Pick<CustomButton, 'fleetTab' | 'shipyardTab'>): boolean {
  return b.category === category && b.subcategory === subcategory && b.fleetTab === inner.fleetTab && b.shipyardTab === inner.shipyardTab
}

export function pinId(category: string, subcategory: string | null, inner: Pick<CustomButton, 'fleetTab' | 'shipyardTab'>): string {
  return `pin:${category}:${subcategory ?? ''}${inner.fleetTab ? `:${inner.fleetTab}` : ''}${inner.shipyardTab ? `:${inner.shipyardTab}` : ''}`
}

// The label of a pin: the panel's name, then the inner tab it opens on.
export function pinLabel(category: string, subcategory: string | null, inner: Pick<CustomButton, 'fleetTab' | 'shipyardTab'>, labels: { fleetTab?: string; shipyardTab?: string } = {}): string {
  const base = subcategory && subcategory !== category ? subcategory : category
  const parts = [base, inner.fleetTab ? labels.fleetTab ?? inner.fleetTab : null, inner.shipyardTab ? labels.shipyardTab ?? inner.shipyardTab : null].filter(Boolean)
  return parts.join(' · ')
}

// The pinned buttons survive a page reload (browser storage; every use of it is guarded,
// it can be absent or blocked). Buttons saved before inner tabs existed carry none and
// open their panel's default tab.
export const QUICK_BUTTONS_STORAGE_KEY = 'trc.quickButtons.v1'

// The buttons to start with: the default ones, then every valid saved pin.
export function parseSavedButtons(raw: string | null): CustomButton[] {
  const out: CustomButton[] = [...DEFAULT_CUSTOM_BUTTONS]
  if (!raw) return out
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return out
  }
  if (!Array.isArray(data)) return out
  for (const d of data) {
    if (!d || typeof d !== 'object') continue
    const b = d as Record<string, unknown>
    if (typeof b.id !== 'string' || typeof b.label !== 'string' || typeof b.category !== 'string') continue
    if (b.subcategory !== null && typeof b.subcategory !== 'string') continue
    if (out.some((x) => x.id === b.id)) continue
    out.push({
      id: b.id,
      label: b.label,
      category: b.category,
      subcategory: b.subcategory as string | null,
      ...(typeof b.fleetTab === 'string' ? { fleetTab: b.fleetTab as FleetTab } : {}),
      ...(typeof b.shipyardTab === 'string' ? { shipyardTab: b.shipyardTab } : {}),
    })
  }
  return out
}

function readSaved(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(QUICK_BUTTONS_STORAGE_KEY)
  } catch {
    return null
  }
}

interface CustomButtonStore {
  buttons: CustomButton[]
  // Pin a panel (with its inner tabs); returns false if it is already pinned.
  pin: (category: string, subcategory: string | null, inner?: Pick<CustomButton, 'fleetTab' | 'shipyardTab'>, labels?: { fleetTab?: string; shipyardTab?: string }) => boolean
  remove: (id: string) => void
}

export const useCustomButtonStore = create<CustomButtonStore>((set, get) => ({
  buttons: parseSavedButtons(readSaved()),
  pin: (category, subcategory, inner = {}, labels) => {
    if (get().buttons.some((b) => samePin(b, category, subcategory, inner))) return false
    set((s) => ({ buttons: [...s.buttons, { id: pinId(category, subcategory, inner), label: pinLabel(category, subcategory, inner, labels), category, subcategory, ...inner }] }))
    return true
  },
  remove: (id) => set((s) => ({ buttons: s.buttons.filter((b) => b.id !== id || b.builtin) })),
}))

// Save every change (never the built-in default, which is always re-added).
useCustomButtonStore.subscribe((state, before) => {
  if (state.buttons === before.buttons) return
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(QUICK_BUTTONS_STORAGE_KEY, JSON.stringify(state.buttons.filter((b) => !b.builtin)))
  } catch {
    // Storage blocked or full: the buttons just last for the session.
  }
})
