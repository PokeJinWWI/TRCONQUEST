// The rural district of a world in the live game: its ground, the people living on it and the homesteads that stand there.
// Read-only (no store is written), derived from the zones, the placement ledger and the world's population.
import { usePlacementStore } from '../state/placementStore'
import { useZoneStore } from '../state/zoneStore'
import { markCount, homesteadCells, ruralPopulation } from './ruralLife'
import { bodyPopulation } from './urbanPopulation'
import { bodyZones, zoneBase } from './zoneOrders'
import { ruralCells } from './zoning'

export interface RuralSummary {
  // Cells of untouched buildable ground in no zone (nature reserves included).
  cells: number
  // People (millions) living there.
  millions: number
  // Cells that carry a homestead mark.
  marks: number[]
  reserved: number
}

// Share of the developed district levels that farm (levels at agricultural sites over all levels), 0 when nothing is developed.
function farmingShare(bodyName: string): number {
  let agri = 0
  let all = 0
  for (const [siteId, districts] of Object.entries(usePlacementStore.getState().levels)) {
    if (!siteId.startsWith(`${bodyName}#`)) continue
    for (const [d, n] of Object.entries(districts)) {
      all += n
      if (d === 'agricultural') agri += n
    }
  }
  return all > 0 ? agri / all : 0
}

export function ruralSummary(bodyName: string): RuralSummary {
  const base = zoneBase(bodyName)
  if (!base) return { cells: 0, millions: 0, marks: [], reserved: 0 }
  const rural = ruralCells(base, Object.values(bodyZones(bodyName)))
  const reserves = new Set(useZoneStore.getState().reserves[bodyName] ?? [])
  const millions = ruralPopulation(bodyPopulation(bodyName), farmingShare(bodyName))
  const marks = homesteadCells(base, new Set(rural), markCount(millions), reserves)
  return { cells: rural.length, millions, marks, reserved: reserves.size }
}
