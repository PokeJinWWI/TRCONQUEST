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

// Worlds with an economy are shaded by their real annual GDP (from whichever
// economy mode is running — `gdpByBody`), on a log scale against the richest
// world in view so a small colony still shows. A body with no economy is
// ranked by district count (bodyStats.estimateSize, from its real radius) in
// the dim bottom band, below every inhabited world.
const NO_ECONOMY_BAND = 0.12
export function gdpColors(planets: PlanetData[], gdpByBody: Record<string, number> = {}): Map<string, string> {
  const colors = new Map<string, string>()
  const withGdp = planets.filter((p) => (gdpByBody[p.name] ?? 0) > 0)
  const max = Math.max(1, ...withGdp.map((p) => gdpByBody[p.name]))
  const logMax = Math.log10(1 + max)
  for (const p of withGdp) colors.set(p.name, lerpHex(GDP_LOW, GDP_HIGH, NO_ECONOMY_BAND + (1 - NO_ECONOMY_BAND) * (Math.log10(1 + gdpByBody[p.name]) / logMax)))
  const rest = planets.filter((p) => !colors.has(p.name)).sort((a, b) => estimateSize(a.radiusKm).districts - estimateSize(b.radiusKm).districts)
  rest.forEach((p, i) => colors.set(p.name, lerpHex(GDP_LOW, GDP_HIGH, rest.length > 1 ? (i / (rest.length - 1)) * NO_ECONOMY_BAND : 0)))
  return colors
}

// Unowned/unclaimed — a dull neutral gray, distinct from any real country
// color (see countryData.ts).
const UNCLAIMED_COLOR = '#4a4a52'

// Colored by the LIVE owner (state/territoryStore.ts), so a world ceded in a
// peace treaty recolors immediately. Falls back to the authored planet data
// only when no live ownership map is passed (a caller outside a game).
function politicalColors(planets: PlanetData[], owners?: Record<string, string>): Map<string, string> {
  const colors = new Map<string, string>()
  for (const p of planets) {
    const owner = owners ? owners[p.name] : p.ownerId
    colors.set(p.name, (owner && getCountry(owner)?.color) || UNCLAIMED_COLOR)
  }
  return colors
}

// Per-planet color overrides for the active map mode, keyed by planet name —
// null when no mode is active, meaning every planet renders its own natural
// color (see planetData's `color`). `owners` is the live territory map;
// `gdpByBody` each inhabited world's annual GDP (state/nationEconomy.ts).
export function mapModeColorsFor(mode: MapMode, planets: PlanetData[], owners?: Record<string, string>, gdpByBody?: Record<string, number>): Map<string, string> | null {
  if (mode === 'gdp') return gdpColors(planets, gdpByBody)
  if (mode === 'political') return politicalColors(planets, owners)
  return null
}
