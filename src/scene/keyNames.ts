import { getCountry } from '../data/countryData'
import type { KeySlot } from './planetTerrain'

// What to call a key node: a kind ("City", "Spaceport"…), and for a nation's
// capital on its home world, the capital city's name when it has one
// ("Akakyō (capital)").
export const KEY_KIND_LABEL: Record<KeySlot['kind'], string> = { capital: 'Capital', city: 'City', spaceport: 'Spaceport', outpost: 'Outpost', fortress: 'Fortress' }

export function keySlotLabel(bodyName: string, slot: Pick<KeySlot, 'kind'>, ownerId: string | undefined): string {
  if (slot.kind === 'capital' && ownerId) {
    const country = getCountry(ownerId)
    if (country?.capitalBodyName === bodyName && country.capitalCityName) return `${country.capitalCityName} (capital)`
  }
  return KEY_KIND_LABEL[slot.kind]
}
