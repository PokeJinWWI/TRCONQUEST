// The player's armies grouped for the Outliner: one row per world they stand
// on (or are being raised on), and one per transport carrying some. Pure.
import { ARMY_KINDS } from '../data/armyData'
import type { Army } from './armyLogic'
import { bodyStarId } from './territory'
import type { ShipInstance } from '../state/shipStore'

export interface ArmyGroup {
  key: string
  label: string
  // e.g. "2 assault · 3 garrison"
  detail: string
  // A world's group opens its ground map; a transport's selects the ship.
  bodyName?: string
  shipId?: string
  starId?: string
}

function describe(armies: Army[]): string {
  const counts = new Map<string, number>()
  let recruiting = 0
  for (const a of armies) {
    if (a.location.kind === 'recruiting') recruiting++
    else counts.set(ARMY_KINDS[a.kind].id, (counts.get(ARMY_KINDS[a.kind].id) ?? 0) + 1)
  }
  const parts = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([kind, n]) => `${n} ${kind}`)
  if (recruiting > 0) parts.push(`${recruiting} training`)
  return parts.join(' · ')
}

export function playerArmyGroups(armies: Army[], ships: Pick<ShipInstance, 'id' | 'name'>[], playerId: string | null): ArmyGroup[] {
  if (!playerId) return []
  const mine = armies.filter((a) => a.ownerId === playerId)
  const byPlace = new Map<string, Army[]>()
  for (const a of mine) {
    const place = a.location.kind === 'embarked' ? `ship:${a.location.shipId}` : `body:${a.location.bodyName}`
    byPlace.set(place, [...(byPlace.get(place) ?? []), a])
  }
  const shipName = new Map(ships.map((s) => [s.id, s.name]))
  const groups: ArmyGroup[] = []
  for (const [place, list] of byPlace) {
    if (place.startsWith('ship:')) {
      const shipId = place.slice(5)
      groups.push({ key: place, label: `Aboard ${shipName.get(shipId) ?? 'transport'}`, detail: describe(list), shipId })
    } else {
      const bodyName = place.slice(5)
      groups.push({ key: place, label: bodyName, detail: describe(list), bodyName, starId: bodyStarId(bodyName) })
    }
  }
  return groups.sort((a, b) => a.label.localeCompare(b.label))
}
