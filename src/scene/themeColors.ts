// The 3D maps' interface colours (orbit rings, hyperlanes, map grids, the combat lattice) per UI
// theme (state/themeStore.ts). Default = the original colours. NERV draws the map itself in the
// show's mint-green line work (orbits, lanes, grids) and keeps frames orange, like its tactical screens;
// Ichor draws them in antique gold over dark bronze; Yesteryear in claret and rose over dark wine. All leave alone everything that carries meaning:
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
  win95: { orbit: '#c0c0c0', lane: '#00c0c0', grid: '#808080', gridPoint: '#c0c0c0', frame: '#ffffff', lattice: '#404040', latticeNode: '#c0c0c0', toneMapped: false },
  nerv: { orbit: '#3df5b0', lane: '#3df5b0', grid: '#3df5b0', gridPoint: '#7dffc8', frame: '#ff9900', lattice: '#0e5a40', latticeNode: '#3df5b0', toneMapped: false },
  ichor: { orbit: '#c9a24a', lane: '#e6c878', grid: '#b8923c', gridPoint: '#e6c878', frame: '#c9a24a', lattice: '#5a4416', latticeNode: '#c9a24a', toneMapped: false },
  yesteryear: { orbit: '#b8445e', lane: '#e07b8f', grid: '#9a2c45', gridPoint: '#e07b8f', frame: '#b83252', lattice: '#4a1220', latticeNode: '#b83252', toneMapped: false },
}

export function useSceneColors(): SceneColors {
  const theme = useThemeStore((s) => s.theme)
  const phosphor = useThemeStore((s) => s.phosphor)
  const hue = useThemeStore((s) => s.phosphorHue)
  // Terminal: the line work follows the chosen phosphor (a new object per change, memoised by the zustand primitives).
  return useMemo(() => (theme === 'terminal' ? phosphorSceneColors(phosphorOf(phosphor, hue)) : SCENE_COLORS[theme]), [theme, phosphor, hue])
}
