import { create } from 'zustand'

export type ViewLevel = 'galactic' | 'interstellar' | 'system' | 'satellite'

interface ViewState {
  level: ViewLevel
  selectedStarId: string
  // The planet, star (e.g. "Sol"), or other body currently open in satellite
  // view — not just planets, hence the generic name.
  selectedBodyName: string | null
  enterInterstellar: () => void
  enterSystem: (starId: string) => void
  enterSatellite: (bodyName: string) => void
  // Returning to system view via zoom-out (as opposed to the breadcrumb or a
  // fresh arrival) keeps `selectedBodyName` set so SolarSystemScene can start
  // the camera near that body instead of resetting to the far default view.
  exitSatelliteToSystem: () => void
  enterGalactic: () => void
}

export const useViewStore = create<ViewState>((set) => ({
  level: 'system',
  selectedStarId: 'sol',
  selectedBodyName: null,
  enterGalactic: () => set({ level: 'galactic', selectedBodyName: null }),
  enterInterstellar: () => set({ level: 'interstellar', selectedBodyName: null }),
  enterSystem: (starId) => set({ level: 'system', selectedStarId: starId, selectedBodyName: null }),
  enterSatellite: (bodyName) => set({ level: 'satellite', selectedBodyName: bodyName }),
  exitSatelliteToSystem: () => set({ level: 'system' }),
}))
