// Quality of life read from the running game (scene/qualityOfLife.ts is the rule).
import { POP_PER_CAPACITY } from '../data/urbanData'
import { atWar } from '../state/diplomacyStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { siteOwner } from '../state/locationStore'
import { isAbstractEconomy } from '../state/playerStore'
import { useShipStore } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { unrestNow } from '../state/unrestStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { habitabilityOfClass } from '../economy/habitability'
import { orbitedBody, isArmed } from './armyLogic'
import { accessOnBody } from './infrastructureOrders'
import { locationsOf, baseCapacity } from './locations'
import { bodyGroundInfoAny } from './planetTerrain'
import { nationQualityOfLife, qualityOfLife, type QolIndicator } from './qualityOfLife'
import { bodyPopulation } from './urbanPopulation'

// The indicators of one body as its owner lives them. Null where nobody owns the body.
export function qualityOfLifeNow(bodyName: string): QolIndicator[] | null {
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  const owner = bodyOwner[bodyName]
  if (!owner) return null
  const sites = locationsOf(bodyName)
  const room = sites.filter((s) => s.kind === 'settlement' && siteOwner(s.id) === owner).reduce((n, s) => n + baseCapacity(s) * POP_PER_CAPACITY, 0)
  const population = bodyPopulation(bodyName)
  const access = accessOnBody(bodyName, owner)
  const mine = sites.filter((s) => siteOwner(s.id) === owner).map((s) => access[s.id] ?? 1)
  const complex = !isAbstractEconomy()
  const world = complex ? worldByName(useEconomyStore.getState().worlds, bodyName) : undefined
  const info = bodyGroundInfoAny(bodyName)
  const habitability = world?.habitability ?? (complex ? 1 : info ? habitabilityOfClass(info.planetClass) : 1)
  const country = useEconomyStore.getState().countries.find((c) => c.id === owner)
  const ships = useShipStore.getState().ships
  return qualityOfLife({
    habitability,
    housing: room > 0 ? { population, room } : null,
    access: mine,
    unrest: unrestNow(owner, useGameTimeStore.getState().simDays),
    occupied: !!bodyController[bodyName] && bodyController[bodyName] !== owner,
    atWar: Object.values(bodyOwner).some((o) => o !== owner && atWar(owner, o)),
    enemyInOrbit: ships.some((s) => orbitedBody(s) === bodyName && s.ownerId !== owner && atWar(owner, s.ownerId) && isArmed(s)),
    services: complex && country ? { healthcare: country.publicServices?.healthcare ?? 0, education: country.publicServices?.education ?? 0 } : null,
  })
}

export function nationQualityOfLifeNow(nationId: string): QolIndicator[] {
  const owners = useTerritoryStore.getState().bodyOwner
  const bodies = Object.keys(owners).filter((b) => owners[b] === nationId)
  const rows = bodies.map((b) => ({ weight: Math.max(0.0001, bodyPopulation(b)), indicators: qualityOfLifeNow(b) ?? [] })).filter((r) => r.indicators.length > 0 && r.weight > 0.0001)
  return nationQualityOfLife(rows)
}
