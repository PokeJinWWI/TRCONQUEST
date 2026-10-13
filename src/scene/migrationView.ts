// What draws people to a world, for the Population tab's Migration card. Complex: from the world and its last labour report; Simple:
// jobs, housing and safety only.
import { attractionOfWorld } from '../economy/migration'
import { worldJobs, worldWorkforce } from '../economy-abstract/abstractEconomy'
import { attractionOf, pushOf } from '../economy/migrationRules'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { useMigrationStore, lawsOfNation } from '../state/migrationStore'
import { useTerritoryStore } from '../state/territoryStore'
import { isAbstractEconomy } from '../state/playerStore'
import { distressByBody } from './migrationDistress'

export interface AttractionView {
  total: number
  terms: { label: string; value: number | null; note: string }[]
}

export function attractionBreakdownOf(bodyName: string): AttractionView | null {
  const owner = useTerritoryStore.getState().bodyOwner[bodyName]
  if (!owner) return null
  const encouraged = lawsOfNation(owner, useMigrationStore.getState().laws).immigration === 'encouraged'
  const distress = distressByBody()[bodyName] ?? 0
  let a
  if (isAbstractEconomy()) {
    const w = useAbstractEconomyStore.getState().worlds[bodyName]
    if (!w) return null
    const workforce = worldWorkforce(w)
    a = attractionOf({ standardOfLiving: null, vacancyRatio: workforce > 0 ? (worldJobs(w) - workforce) / workforce : 0, roomRatio: 1, safety: 1 - pushOf(distress + (w.devastation ?? 0) * 0.5), cultureShare: 1, encouraged })
  } else {
    const st = useEconomyStore.getState()
    const w = worldByName(st.worlds, bodyName)
    if (!w) return null
    const culture = w.pops.slice().sort((x, y) => y.populationSize - x.populationSize)[0]?.cultureId ?? w.cultureId
    a = attractionOfWorld(w, st.worldReports[w.id], distress, culture, encouraged)
  }
  const t = a.terms
  return {
    total: a.total,
    terms: [
      { label: 'Standard of living', value: t.sol, note: t.sol === null ? 'Simple mode has no standard of living' : 'How well the people here live' },
      { label: 'Jobs', value: t.jobs, note: 'Jobs posted against people looking for work: above 50% there are more jobs than hands' },
      { label: 'Housing', value: t.housing, note: 'Room for the people against how many there are' },
      { label: 'Safety', value: t.safety, note: 'Peace at home: war, occupation, displacement, famine pull this down' },
      { label: 'Culture', value: t.culture, note: 'The share of people here of the main culture' },
    ],
  }
}
