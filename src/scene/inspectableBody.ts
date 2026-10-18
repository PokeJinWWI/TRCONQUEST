import type { KnownStatus, PlanetClass } from './planetData'

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
  // Real-world catalogue status; absent for a body the game generated.
  catalogStatus?: KnownStatus
}
