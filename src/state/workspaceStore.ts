import { create } from 'zustand'
import { useViewStore } from './viewStore'
import { useShipStore } from './shipStore'

// A tab is a full snapshot of "where am I, and what's open" — every field
// viewStore holds EXCEPT lockOnEnabled (a camera-behavior preference, not a
// navigation fact — deliberately global, the same across every tab) plus
// shipStore's selectedShipId (the one piece of "which window is open" state
// that lives outside viewStore — see ShipPanel). This is a closed list on
// purpose: every other window in the app (InspectPanel, CombatPanel,
// FleetManagement's own tab state, etc.) is already driven by one of these
// fields, so nothing else needs its own snapshot slot. See viewStore.ts's
// activeNavCategory comment for why NavBar's own state was folded in here
// too rather than staying a special case.
interface TabViewSnapshot {
  level: ReturnType<typeof useViewStore.getState>['level']
  selectedNeighborhoodId: string
  selectedStarId: string
  selectedBodyName: string | null
  inViewSelection: string | null
  combatEngagementId: string | null
  activeNavCategory: string | null
  activeNavSubcategory: string | null
  techTreeOpen: boolean
}

export interface TabSnapshot {
  id: string
  view: TabViewSnapshot
  selectedShipId: string | null
  // A player-chosen override for the tab's label — null means "derive it
  // from the view state" (see TabBar.tsx's autoTabLabel). Independent of
  // navigation, so switching/renaming never touch each other's field.
  name: string | null
}

// The exact defaults viewStore.ts itself hardcodes as its own initial state
// — a fresh tab (including the very first one, at app start) behaves
// identically to how the game already opens today.
function defaultTabView(): TabViewSnapshot {
  return {
    level: 'system',
    selectedNeighborhoodId: 'solar-neighborhood',
    selectedStarId: 'sol',
    selectedBodyName: null,
    inViewSelection: null,
    combatEngagementId: null,
    activeNavCategory: null,
    activeNavSubcategory: null,
    techTreeOpen: false,
  }
}

function newTabId(): string {
  return `tab-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}

interface WorkspaceStore {
  tabs: TabSnapshot[]
  activeTabId: string
  createTab: () => void
  closeTab: (id: string) => void
  switchToTab: (id: string) => void
  renameTab: (id: string, name: string | null) => void
  // Whether the header's center slot is currently showing the tab strip
  // instead of ResourceBar (see TabBar.tsx's HudCenterSwap) — the two never
  // show at once, deliberately, to keep the top bar uncluttered.
  showTabBar: boolean
  toggleTabBar: () => void
}

// Reads the live navigation state out of viewStore/shipStore into a
// snapshot — the "outgoing" half of a tab switch.
function captureActiveTab(): TabViewSnapshot & { selectedShipId: string | null } {
  const v = useViewStore.getState()
  return {
    level: v.level,
    selectedNeighborhoodId: v.selectedNeighborhoodId,
    selectedStarId: v.selectedStarId,
    selectedBodyName: v.selectedBodyName,
    inViewSelection: v.inViewSelection,
    combatEngagementId: v.combatEngagementId,
    activeNavCategory: v.activeNavCategory,
    activeNavSubcategory: v.activeNavSubcategory,
    techTreeOpen: v.techTreeOpen,
    selectedShipId: useShipStore.getState().selectedShipId,
  }
}

// Writes a snapshot back into the live stores — the "incoming" half. Never
// touches lockOnEnabled, deliberately (see this file's own header comment).
function restoreTab(snapshot: TabSnapshot) {
  useViewStore.setState({ ...snapshot.view })
  useShipStore.getState().selectShip(snapshot.selectedShipId)
}

const initialTabId = newTabId()

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  tabs: [{ id: initialTabId, view: defaultTabView(), selectedShipId: null, name: null }],
  activeTabId: initialTabId,
  showTabBar: false,
  toggleTabBar: () => set((s) => ({ showTabBar: !s.showTabBar })),

  createTab: () => {
    const { tabs, activeTabId } = get()
    const captured = captureActiveTab()
    const id = newTabId()
    const updatedTabs = tabs.map((t) => (t.id === activeTabId ? { ...t, view: captured, selectedShipId: captured.selectedShipId } : t))
    const fresh: TabSnapshot = { id, view: defaultTabView(), selectedShipId: null, name: null }
    set({ tabs: [...updatedTabs, fresh], activeTabId: id })
    restoreTab(fresh)
  },

  // An empty/whitespace-only name clears back to the auto-derived label
  // (null) rather than storing a blank string — normalized here, not left to
  // every caller, so a tab can never render with a literally empty title.
  renameTab: (id, name) => {
    const trimmed = name?.trim() || null
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, name: trimmed } : t)) }))
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get()
    if (tabs.length <= 1) return // always at least one tab, matching ordinary browser-tab UX
    const closingIndex = tabs.findIndex((t) => t.id === id)
    if (closingIndex === -1) return
    const remaining = tabs.filter((t) => t.id !== id)

    if (id !== activeTabId) {
      set({ tabs: remaining })
      return
    }
    // Closing the active tab: land on whichever tab was to its left, or the
    // new first tab if it was leftmost — same convention most browsers use.
    const nextActive = remaining[Math.max(0, closingIndex - 1)]
    set({ tabs: remaining, activeTabId: nextActive.id })
    restoreTab(nextActive)
  },

  switchToTab: (id) => {
    const { tabs, activeTabId } = get()
    if (id === activeTabId) return
    const target = tabs.find((t) => t.id === id)
    if (!target) return
    const captured = captureActiveTab()
    const updatedTabs = tabs.map((t) => (t.id === activeTabId ? { ...t, view: captured, selectedShipId: captured.selectedShipId } : t))
    set({ tabs: updatedTabs, activeTabId: id })
    restoreTab(target)
  },
}))
