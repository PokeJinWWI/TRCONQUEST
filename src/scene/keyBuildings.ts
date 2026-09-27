// The buildings that ARE a world's key nodes (both economy modes): the capital's
// Government Seat (and its nation's landmarks), each city's City Hall, the
// spaceport, an outpost's station. Derived from the ground map's key slots —
// one source of truth with the ground war — so taking the node takes the
// building. They use no district slot and can't be demolished; the planet
// screen shows them in a Civic group and the Defense tab lists them as key
// sites. Fortress key nodes are installations and show in the Military district.
import { COUNTRIES } from '../data/countryData'
import { LANDMARKS } from '../data/landmarks'
import { KEY_ROLE, keyNameOf } from './keyNames'
import { holderOf, type NodeHolderMap } from './groundLogic'
import { isActive, withInstallationKeys, type Installation } from './defenseLogic'
import type { BodySurface, KeySlot } from './planetTerrain'
import type { OwnerMap } from './territory'

export type KeyBuildingKind = 'seat' | 'landmark' | 'cityHall' | 'spaceport' | 'outpostStation'

export interface KeyBuilding {
  id: string
  kind: KeyBuildingKind
  name: string // "Imperial Palace of Mars", "Rakuyō City Hall", "Kythera Spaceport"
  place: string // the key node's own label ("Akakyō (capital)")
  native?: string // the place's name in its own script (Mars's kanji)
  node: number
  slotKind: KeySlot['kind']
  description: string
  role: string // what holding the node does (keyNames.KEY_ROLE)
  holder: string | undefined // who holds the node now
  captured: boolean // held by someone other than the world's owner
  building: boolean // a spaceport still under construction (no key node yet)
}

export const KEY_BUILDING_ICON: Record<KeyBuildingKind, string> = { seat: 'seat', landmark: 'seat', cityHall: 'cityHall', spaceport: 'spaceport', outpostStation: 'outpostStation' }

const nationWithCapital = (bodyName: string) => COUNTRIES.find((c) => c.capitalBodyName === bodyName)

export function keyBuildingsOf(surface: BodySurface, installations: Installation[], simDays: number, owners: OwnerMap, holders: NodeHolderMap): KeyBuilding[] {
  const s = withInstallationKeys(surface, installations, simDays)
  const owner = owners[s.bodyName]
  const out: KeyBuilding[] = []
  const held = (node: number) => {
    const holder = holderOf(s.bodyName, node, owners, holders)
    return { holder, captured: !!holder && !!owner && holder !== owner }
  }
  const capitalOf = nationWithCapital(s.bodyName)
  const marks = capitalOf ? LANDMARKS[capitalOf.id] : undefined
  for (const slot of s.keySlots) {
    if (slot.kind === 'fortress') continue
    const n = keyNameOf(s, slot)
    const base = { node: slot.node, slotKind: slot.kind, place: n.label, native: n.native, role: KEY_ROLE[slot.kind], building: false, ...held(slot.node) }
    const town = n.name ?? ''
    if (slot.kind === 'capital') {
      out.push({ ...base, id: `key-${slot.node}-seat`, kind: 'seat', name: marks?.seat.name ?? (town ? `${town} Government Seat` : 'Government Seat'), description: marks?.seat.description ?? 'The seat of this world’s government.' })
      for (const [i, m] of (marks?.others ?? []).entries()) out.push({ ...base, id: `key-${slot.node}-landmark-${i}`, kind: 'landmark', name: m.name, description: m.description })
    } else if (slot.kind === 'city') {
      out.push({ ...base, id: `key-${slot.node}-hall`, kind: 'cityHall', name: town ? `${town} City Hall` : 'City Hall', description: `The civic centre of ${town || 'this city'}.` })
    } else if (slot.kind === 'spaceport') {
      out.push({ ...base, id: `key-${slot.node}-port`, kind: 'spaceport', name: n.label, description: 'The world’s spaceport: its landing fields and orbital lift.' })
    } else {
      out.push({ ...base, id: `key-${slot.node}-station`, kind: 'outpostStation', name: town ? `${town} Outpost Station` : 'Outpost Station', description: 'The settlement’s station: habitat, landing pad and relay.' })
    }
  }
  // A spaceport being built: shown, but no key node until it's ready.
  for (const i of installations) {
    if (i.bodyName !== s.bodyName || i.kind !== 'spaceport' || i.integrity <= 0 || isActive(i, simDays)) continue
    out.push({ id: `key-${i.node}-port-building`, kind: 'spaceport', name: 'Spaceport', place: 'under construction', node: i.node, slotKind: 'spaceport', description: 'A new spaceport: once built, the world’s spaceport key node.', role: KEY_ROLE.spaceport, building: true, holder: owner, captured: false })
  }
  return out
}
