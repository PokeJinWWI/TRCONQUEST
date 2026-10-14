// The 3D maps' interface colours (orbit rings, hyperlanes, map grids, the combat lattice) per UI
// theme (state/themeStore.ts). Default = the original colours. NERV draws the map itself in the
// show's mint-green line work (orbits, lanes, grids) and keeps frames orange, like its tactical screens, and leaves alone everything that carries meaning:
// stars, planet surfaces, relation colours, nation and territory colours, map-mode data.
import { useMemo } from 'react'
import { useThemeStore, type ThemeId } from '../state/themeStore'
import { PHOSPHORS, phosphorOf, phosphorSceneColors } from './phosphor'

export interface SceneColors {
  orbit: string
  lane: string
  grid: string
  gridPoint: string
  frame: string
  lattice: string
  latticeNode: string
  // false = draw the colour as is: the renderer's tone mapping would wash NERV's saturated line
  // colours toward white. Default keeps tone mapping, so it looks as it always has.
  toneMapped: boolean
}

export const SCENE_COLORS: Record<ThemeId, SceneColors> = {
  default: { orbit: '#7ce8ff', lane: '#7ce8ff', grid: '#6fe3ff', gridPoint: '#6fe3ff', frame: '#6fe3ff', lattice: '#2b6b80', latticeNode: '#7ce8ff', toneMapped: true },
  terminal: phosphorSceneColors(PHOSPHORS.green),
  nerv: { orbit: '#3df5b0', lane: '#3df5b0', grid: '#3df5b0', gridPoint: '#7dffc8', frame: '#ff9900', lattice: '#0e5a40', latticeNode: '#3df5b0', toneMapped: false },
}

export function useSceneColors(): SceneColors {
  const theme = useThemeStore((s) => s.theme)
  const phosphor = useThemeStore((s) => s.phosphor)
  const hue = useThemeStore((s) => s.phosphorHue)
  // Terminal: the line work follows the chosen phosphor (a new object per change, memoised by the zustand primitives).
  return useMemo(() => (theme === 'terminal' ? phosphorSceneColors(phosphorOf(phosphor, hue)) : SCENE_COLORS[theme]), [theme, phosphor, hue])
}
