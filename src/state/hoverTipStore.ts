import { create } from 'zustand'

// A tooltip for something drawn in 3D (a border on the interstellar map), which
// the DOM-title tooltip layer can't see. The scene sets it from pointer events;
// components/HoverTip.tsx draws it.
interface HoverTip {
  tip: { x: number; y: number; text: string } | null
  setTip: (tip: { x: number; y: number; text: string } | null) => void
}

export const useHoverTipStore = create<HoverTip>((set) => ({
  tip: null,
  setTip: (tip) => set({ tip }),
}))
