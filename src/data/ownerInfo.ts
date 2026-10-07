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

// What a map layer calls an owner the player has not met: every generated empire,
// until first contact exists (scene/encroachment.UNKNOWN_EMPIRE_ID is this id).
export const UNKNOWN_OWNER_ID = 'unknown-empire'
const UNKNOWN_OWNER: OwnerInfo = { name: 'Unknown empire', color: '#8a8f98' }

export function ownerInfoOf(id: string): OwnerInfo | undefined {
  if (id === UNKNOWN_OWNER_ID) return UNKNOWN_OWNER
  const country = getCountry(id)
  if (country) return { name: country.name, color: country.color, capitalStarId: country.capitalStarId }
  const empire = galaxyEmpires().find((e) => e.id === id)
  return empire ? { name: empire.name, color: empire.color, capitalStarId: empire.homeStarId } : undefined
}
