export interface InspectableBody {
  name: string
  kind: 'star' | 'planet' | 'moon'
  color: string
  radiusKm: number
  orbitAU?: number
  orbitPeriodYears?: number
  orbitPeriodDays?: number
  moonCount?: number
}
