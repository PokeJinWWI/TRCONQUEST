import { create } from 'zustand'

export type ViewLevel = 'galactic' | 'interstellar' | 'system' | 'planet'

interface ViewState {
  level: ViewLevel
  selectedStarId: string
  selectedPlanetName: string | null
  enterInterstellar: () => void
  enterSystem: (starId: string) => void
  enterPlanet: (planetName: string) => void
  enterGalactic: () => void
}

export const useViewStore = create<ViewState>((set) => ({
  level: 'system',
  selectedStarId: 'sol',
  selectedPlanetName: null,
  enterGalactic: () => set({ level: 'galactic', selectedPlanetName: null }),
  enterInterstellar: () => set({ level: 'interstellar', selectedPlanetName: null }),
  enterSystem: (starId) => set({ level: 'system', selectedStarId: starId, selectedPlanetName: null }),
  enterPlanet: (planetName) => set({ level: 'planet', selectedPlanetName: planetName }),
}))
