import type { PlanetClass } from './planetData'

export interface InspectableBody {
  name: string
  kind: 'star' | 'planet' | 'moon'
  color: string
  radiusKm: number
  orbitAU?: number
  orbitPeriodYears?: number
  orbitPeriodDays?: number
  moonCount?: number
  // Set only for `kind: 'planet'` bodies — see bodyStats.PLANET_CLASS_LABELS.
  planetClass?: PlanetClass
}
