// The 3D maps' interface colours (orbit rings, hyperlanes, map grids, the combat lattice) per UI
// theme (state/themeStore.ts). Default = the original colours. NERV draws the map itself in the
// show's mint-green line work (orbits, lanes, grids) and keeps frames orange, like its tactical screens;
// Ichor draws them in antique gold over dark bronze; Yesteryear in claret and rose over dark wine. All leave alone everything that carries meaning:
// stars, planet surfaces, relation colours, nation and territory colours, map-mode data.
import { useThemeStore, type ThemeId } from '../state/themeStore'

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
  nerv: { orbit: '#3df5b0', lane: '#3df5b0', grid: '#3df5b0', gridPoint: '#7dffc8', frame: '#ff9900', lattice: '#0e5a40', latticeNode: '#3df5b0', toneMapped: false },
  ichor: { orbit: '#c9a24a', lane: '#e6c878', grid: '#b8923c', gridPoint: '#e6c878', frame: '#c9a24a', lattice: '#5a4416', latticeNode: '#c9a24a', toneMapped: false },
  yesteryear: { orbit: '#b8445e', lane: '#e07b8f', grid: '#9a2c45', gridPoint: '#e07b8f', frame: '#b83252', lattice: '#4a1220', latticeNode: '#b83252', toneMapped: false },
}

export function useSceneColors(): SceneColors {
  return SCENE_COLORS[useThemeStore((s) => s.theme)]
}
