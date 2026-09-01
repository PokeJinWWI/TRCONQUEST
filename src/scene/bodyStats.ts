import type { PlanetClass } from './planetData'

const GAS_GIANTS = new Set(['Jupiter', 'Saturn', 'Uranus', 'Neptune'])

// Flavor taxonomy describing a planet's physical/climate character —
// independent of estimateHabitability below (a terraformed Venus reads as
// "Favorable" there purely by orbital distance, but its class, Ocean, is
// what actually explains why). Assigned by hand per planet in planetData.ts,
// same "hand-authored, not computed" approach as color/orbit values.
export const PLANET_CLASS_LABELS: Record<PlanetClass, string> = {
  continental: 'Continental World',
  ocean: 'Ocean World',
  hycean: 'Hycean World',
  desert: 'Desert World',
  toxic: 'Toxic World',
  barren: 'Barren World',
  ice: 'Ice World',
  lava: 'Lava World',
  eyeball: 'Eyeball World',
  'gas-giant': 'Gas Giant',
  'ice-giant': 'Ice Giant',
}

export interface HabitabilityInfo {
  label: string
  pct: number
}

export interface SizeInfo {
  label: string
  districts: number
}

// These are deliberately simple, transparent heuristics for flavor/game-info
// display — not a real habitability/economy simulation, which this project
// doesn't have yet. Rocky-body habitability roughly follows "closer to a
// sunlike star's habitable zone (~0.9-1.5 AU) is better"; gas giants and
// bodies with no meaningful orbit-around-Sol distance (moons, the star
// itself) are flagged as not applicable; district count scales with real
// body radius.
export function estimateHabitability(name: string, orbitAU: number | undefined): HabitabilityInfo {
  if (GAS_GIANTS.has(name)) return { label: 'Uninhabitable (Gas Giant)', pct: 0 }
  if (orbitAU === undefined) return { label: 'N/A', pct: 0 }
  const distFromMid = Math.abs(orbitAU - 1.2)
  const pct = Math.max(0, Math.min(100, Math.round(100 - distFromMid * 55)))
  const label = pct > 70 ? 'Favorable' : pct > 30 ? 'Marginal' : 'Hostile'
  return { label, pct }
}

export function estimateSize(radiusKm: number): SizeInfo {
  if (radiusKm < 2500) return { label: 'Tiny', districts: 3 }
  if (radiusKm < 5000) return { label: 'Small', districts: 5 }
  if (radiusKm < 7500) return { label: 'Medium', districts: 8 }
  if (radiusKm < 30000) return { label: 'Large', districts: 11 }
  return { label: 'Huge (Gas Giant)', districts: 14 }
}
