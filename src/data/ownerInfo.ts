// Name and colour of whoever owns a system: one of the four nations, or one of the
// generated empires (data/generatedEmpires.ts). Map layers that can show either
// (borders, rings) read it instead of getCountry.
import { getCountry } from './countryData'
import { galaxyEmpires } from './generatedEmpires'

export interface OwnerInfo {
  name: string
  color: string
  capitalStarId?: string
}

export function ownerInfoOf(id: string): OwnerInfo | undefined {
  const country = getCountry(id)
  if (country) return { name: country.name, color: country.color, capitalStarId: country.capitalStarId }
  const empire = galaxyEmpires().find((e) => e.id === id)
  return empire ? { name: empire.name, color: empire.color, capitalStarId: empire.homeStarId } : undefined
}
