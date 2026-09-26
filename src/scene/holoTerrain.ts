import type { TerrainId } from '../data/groundData'

// How the planetary map paints each terrain: a holographic chart — dark water,
// bright glowing land, in teal shades that still tell the ground apart at a
// glance (deep green-teal forest, pale ice, near-white peaks, amber cities).
// Display only; the terrain's rules live in data/groundData.ts.
// Colours are sRGB hex, written to the map's node texture as they are.
export const HOLO_OCEAN = '#03141d'

export const HOLO_TERRAIN: Record<TerrainId, { color: string; land: boolean }> = {
  ocean: { color: HOLO_OCEAN, land: false },
  plains: { color: '#2bd0bc', land: true },
  forest: { color: '#12a08a', land: true },
  desert: { color: '#a4eab8', land: true },
  tundra: { color: '#bdf1ff', land: true },
  mountains: { color: '#e6fffb', land: true },
  urban: { color: '#ffe3a0', land: true },
  rock: { color: '#4e9ea8', land: true },
  lava: { color: '#ff6b3d', land: true },
  cloud: { color: '#2a4b6a', land: true },
  aerostat: { color: '#5fb0ff', land: true },
}
