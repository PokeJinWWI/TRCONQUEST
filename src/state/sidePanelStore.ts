import { create } from 'zustand'

// How wide the player has dragged the two side panels (the nav sidebar on the left, the
// Outliner on the right). A preference, kept across games in localStorage; applied as the
// CSS variables --nav-width / --outliner-width on <html> (components/SidePanelResizer.tsx).
export const SIDE_PANEL_DEFAULT = 220
export const SIDE_PANEL_MIN = 160
export const SIDE_PANEL_MAX = 480
export const SIDE_PANEL_STORAGE_KEY = 'trc.sidePanels.v1'

export type SidePanel = 'nav' | 'outliner'

export const clampSidePanel = (w: number): number => (Number.isFinite(w) ? Math.round(Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, w))) : SIDE_PANEL_DEFAULT)

export function parseSidePanels(raw: string | null): Record<SidePanel, number> {
  const out = { nav: SIDE_PANEL_DEFAULT, outliner: SIDE_PANEL_DEFAULT }
  if (!raw) return out
  try {
    const v = JSON.parse(raw) as Partial<Record<SidePanel, unknown>>
    if (typeof v.nav === 'number') out.nav = clampSidePanel(v.nav)
    if (typeof v.outliner === 'number') out.outliner = clampSidePanel(v.outliner)
  } catch {
    // Unreadable: defaults.
  }
  return out
}

function readSaved(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(SIDE_PANEL_STORAGE_KEY)
  } catch {
    return null
  }
}

interface SidePanelState {
  widths: Record<SidePanel, number>
  setWidth: (panel: SidePanel, width: number) => void
}

export const useSidePanelStore = create<SidePanelState>((set) => ({
  widths: parseSidePanels(readSaved()),
  setWidth: (panel, width) => set((s) => ({ widths: { ...s.widths, [panel]: clampSidePanel(width) } })),
}))

// Put the widths on the page, and save them.
function apply(widths: Record<SidePanel, number>): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--nav-width', `${widths.nav}px`)
  document.documentElement.style.setProperty('--outliner-width', `${widths.outliner}px`)
}
apply(useSidePanelStore.getState().widths)
useSidePanelStore.subscribe((state, before) => {
  if (state.widths === before.widths) return
  apply(state.widths)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SIDE_PANEL_STORAGE_KEY, JSON.stringify(state.widths))
  } catch {
    // Storage blocked or full: the widths last for the session.
  }
})
