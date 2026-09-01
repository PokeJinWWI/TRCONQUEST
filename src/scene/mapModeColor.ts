import type { PlanetData } from './planetData'
import { estimateSize } from './bodyStats'
import { getCountry } from '../data/countryData'
import type { MapMode } from '../state/mapModeStore'

interface RGB {
  r: number
  g: number
  b: number
}

const GDP_LOW: RGB = { r: 0x1c, g: 0x2e, b: 0x1c }
const GDP_HIGH: RGB = { r: 0x2c, g: 0xff, b: 0x6a }

function lerpHex(a: RGB, b: RGB, t: number): string {
  const r = Math.round(a.r + (b.r - a.r) * t)
  const g = Math.round(a.g + (b.g - a.g) * t)
  const bch = Math.round(a.b + (b.b - a.b) * t)
  return `#${[r, g, bch].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

// A planet with no real economy data behind it yet — ranked by district
// count (bodyStats.estimateSize, itself derived from real radius) as an
// honest stand-in for "how developed this world is" rather than inventing a
// wholly new GDP number this project has nothing to back up.
function gdpColors(planets: PlanetData[]): Map<string, string> {
  const ranked = [...planets].sort((a, b) => estimateSize(a.radiusKm).districts - estimateSize(b.radiusKm).districts)
  const colors = new Map<string, string>()
  ranked.forEach((p, i) => {
    const t = ranked.length > 1 ? i / (ranked.length - 1) : 1
    colors.set(p.name, lerpHex(GDP_LOW, GDP_HIGH, t))
  })
  return colors
}

// Unowned/unclaimed — a dull neutral gray, distinct from any real country
// color (see countryData.ts).
const UNCLAIMED_COLOR = '#4a4a52'

function politicalColors(planets: PlanetData[]): Map<string, string> {
  const colors = new Map<string, string>()
  for (const p of planets) {
    colors.set(p.name, (p.ownerId && getCountry(p.ownerId)?.color) || UNCLAIMED_COLOR)
  }
  return colors
}

// Per-planet color overrides for the active map mode, keyed by planet name —
// null when no mode is active, meaning every planet renders its own natural
// color (see planetData's `color`).
export function mapModeColorsFor(mode: MapMode, planets: PlanetData[]): Map<string, string> | null {
  if (mode === 'gdp') return gdpColors(planets)
  if (mode === 'political') return politicalColors(planets)
  return null
}
