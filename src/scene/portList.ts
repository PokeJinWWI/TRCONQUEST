// A world's spaceports as the player sees them: one row per key node, the same list on the Buildings tab and the Development tab
// (docs/territorial-design.md section 14). A spaceport stands on its own ground, in no area and on no site, and is a key node of the
// ground map wherever it is; what it can still say is the urban or other area its node happens to lie in and its region.
import { siteName } from '../state/locationStore'
import { groundKeySurface, useDefenseStore } from '../state/defenseStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useTerritoryStore } from '../state/territoryStore'
import { spaceportSitesOf } from '../state/nationEconomy'
import { regionAt } from './bodyTopography'
import { areaAtNode } from './areas'
import { bodyAreas } from './footprintState'
import { keyBuildingsOf } from './keyBuildings'
import { zoneBase } from './zoneOrders'

export interface PortRow {
  id: string
  node: number
  name: string
  operator: string | null
  // The area its node lies in ("Akakyō"), if any: standing in a city does not make it part of the city's districts.
  area: string | null
  region: string | null
  // Ordered, not built yet: no key node until it is.
  building: boolean
  captured: boolean
}

export interface PortList {
  rows: PortRow[]
  // What the economy runs (one per level); differs from the rows only on a world whose spaceports are a hand-curated set (Earth).
  economy: number
}

export function portList(bodyName: string): PortList {
  const surface = groundKeySurface(bodyName)
  const economy = spaceportSitesOf(bodyName).length
  if (!surface) return { rows: [], economy }
  const { bodyOwner, nodeHolders } = useTerritoryStore.getState()
  const base = zoneBase(bodyName)
  const areas = base ? bodyAreas(bodyName, base) : []
  const rows = keyBuildingsOf(surface, useDefenseStore.getState().installations, useGameTimeStore.getState().simDays, bodyOwner, nodeHolders)
    .filter((k) => k.kind === 'spaceport')
    .map((k): PortRow => {
      const area = areas.length > 0 ? areaAtNode(areas, k.node, 0) : undefined
      return { id: k.id, node: k.node, name: k.name, operator: k.operator ?? null, area: area ? siteName(area.id) : null, region: regionAt(bodyName, k.node), building: k.building, captured: k.captured }
    })
  return { rows, economy }
}
