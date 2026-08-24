import { create } from 'zustand'

// Player-facing display preferences — distinct from gameTimeStore/viewStore,
// which hold session/navigation state rather than "how the player likes
// things drawn."
export type LineThickness = 'thin' | 'medium' | 'thick'

// Real screen-space pixel widths, fed straight to Line2's `linewidth` (which,
// unlike WebGL's native LineBasicMaterial.linewidth, actually renders at more
// than one hardware pixel — see CombatPathLine's own comment on why Line2 is
// used at all). 'thick' is what every route line rendered at before this
// setting existed, so it stays the default — nothing changes for a player
// who never opens Settings. 'thin' reproduces the old LineBasicMaterial-era
// look for anyone who preferred it.
export const LINE_THICKNESS_PX: Record<LineThickness, number> = {
  thin: 1,
  medium: 1.8,
  thick: 2.6,
}

export const LINE_THICKNESS_LABELS: Record<LineThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
}

export const LINE_THICKNESS_OPTIONS: LineThickness[] = ['thin', 'medium', 'thick']

interface SettingsState {
  navigationLineThickness: LineThickness
  setNavigationLineThickness: (thickness: LineThickness) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  navigationLineThickness: 'thick',
  setNavigationLineThickness: (thickness) => set({ navigationLineThickness: thickness }),
}))
