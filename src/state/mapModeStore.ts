import { create } from 'zustand'

// Which visual overlay the system view's planets are colored by — 'none'
// means each planet's own natural color (see planetData's `color`). Session
// state only, same as every other store here.
export type MapMode = 'none' | 'gdp' | 'political'

export const MAP_MODE_LABELS: Record<MapMode, string> = {
  none: 'None',
  gdp: 'GDP',
  political: 'Political',
}

interface MapModeState {
  mode: MapMode
  setMode: (mode: MapMode) => void
}

export const useMapModeStore = create<MapModeState>((set) => ({
  mode: 'none',
  setMode: (mode) => set({ mode }),
}))
