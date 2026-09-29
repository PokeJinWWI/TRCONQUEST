// Colonies and Influence, store side: founding a colony from a Colony Ship,
// the seeded colonies, settlers and the monthly Influence. The rules are pure in
// scene/colonyLogic.ts; hooks/useColonyResolver.ts promotes micro-colonies.
import {
  COLONY_FOUNDING_DAYS,
  INFLUENCE_CAP,
  INFLUENCE_PER_MONTH,
  MICRO_COLONY_LAND,
  SETTLER_SOURCE_FLOOR,
  STARTING_INFLUENCE,
} from '../data/colonyData'
import { COUNTRIES, getCountry } from '../data/countryData'
import { ownerDisplay } from '../data/countryRoster'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useArmyStore } from '../state/armyStore'
import { useColonyStore } from '../state/colonyStore'
import { atWar, useDiplomacyStore } from '../state/diplomacyStore'
import { isAbstractEconomy } from '../state/playerStore'
import { useResourceStore } from '../state/resourceStore'
import { resolveShipClass } from '../state/shipClassResolver'
import { isPlayerOwned } from '../state/shipRelations'
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { useSurveyStore } from '../state/surveyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { hostileWarshipsAt, orbitedBody } from './armyLogic'
import { landForBody } from './bodyLand'
import { colonyInfluenceCost, placeOutpostNode } from './colonyLogic'
import { queueMoveOrder } from './commsVisual'
import { groundSurface } from './groundLogic'
import { queueShipCommand } from './shipCommands'
import { bodyStarId } from './territory'
import { starbaseOwnersOf } from './starbaseLogic'
import { useStarbaseStore } from '../state/starbaseStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { STARS } from '../data/starData'

function nameOf(id: string): string {
  return ownerDisplay(id).name
}

// --- Influence -------------------------------------------------------------

// A nation's starting Influence and its "+2/mo" (run after the other seeds,
// which zero every monthly figure). Fills an empty slot only.
export function seedInfluence(countryId: string): void {
  const res = useResourceStore.getState()
  if ((res.stateFor(countryId).amounts.influence ?? 0) === 0) res.setAmount(countryId, 'influence', STARTING_INFLUENCE)
  res.setMonthlyDelta(countryId, 'influence', INFLUENCE_PER_MONTH)
}

// `months` of Influence income, up to the cap.
export function applyInfluenceIncome(countryId: string, months: number): void {
  if (months <= 0) return
  const res = useResourceStore.getState()
  const now = res.stateFor(countryId).amounts.influence ?? 0
  res.setAmount(countryId, 'influence', Math.min(INFLUENCE_CAP, now + INFLUENCE_PER_MONTH * months))
}

// --- Colonies --------------------------------------------------------------

// What founding a colony on `bodyName` costs `countryId` in Influence.
export function colonyCostFor(countryId: string, bodyName: string): number {
  const capitalStar = getCountry(countryId)?.capitalStarId ?? 'sol'
  return colonyInfluenceCost(bodyName, bodyStarId(bodyName) ?? capitalStar, capitalStar)
}

// Every body owned at the start is a planetary colony with its outpost.
export function seedColonies(simDays: number): void {
  const owners = useTerritoryStore.getState().bodyOwner
  const colonies = { ...useColonyStore.getState().colonies }
  let changed = false
  for (const bodyName of Object.keys(owners)) {
    if (colonies[bodyName]) continue
    const surface = groundSurface(bodyName, owners)
    const outpostNode = surface ? placeOutpostNode(surface) : null
    if (outpostNode === null) continue
    colonies[bodyName] = { bodyName, outpostNode, stage: 'planetary', foundedSimDays: simDays, orbitSecureSinceSimDays: null }
    changed = true
  }
  if (changed) useColonyStore.getState().setColonies(colonies)
}

export type ColonizeResult = { ok: true; cost: number } | { ok: false; reason: string }

// Whether this Colony Ship could found a colony on `bodyName` now.
// `anywhere` skips "must be in orbit there" (for a menu that flies it there).
export function canColonize(ship: ShipInstance, bodyName: string, opts: { anywhere?: boolean } = {}): ColonizeResult {
  if (!isAbstractEconomy()) return { ok: false, reason: 'Colonies need Simple economy mode for now' }
  if (resolveShipClass(ship.classId)?.role !== 'colony') return { ok: false, reason: 'Only a Colony Ship can found a colony' }
  if (!opts.anywhere && orbitedBody(ship) !== bodyName) return { ok: false, reason: `The ship must be in orbit of ${bodyName}` }
  if (!useSurveyStore.getState().discovered[ship.ownerId]?.surveyed.has(bodyName)) return { ok: false, reason: `Survey ${bodyName} first` }
  const starId = bodyStarId(bodyName)
  if (!starId || !starbaseOwnersOf(starId, useStarbaseStore.getState().starbases, useGameTimeStore.getState().simDays).includes(ship.ownerId)) {
    return { ok: false, reason: `Needs a Starbase of your own in ${STARS.find((s) => s.id === starId)?.name ?? 'that system'}` }
  }
  const owner = useTerritoryStore.getState().bodyOwner[bodyName]
  if (owner) return { ok: false, reason: owner === ship.ownerId ? `You already hold ${bodyName}` : `${nameOf(owner)} already holds ${bodyName}` }
  const surface = groundSurface(bodyName, useTerritoryStore.getState().bodyOwner)
  if (!surface || surface.mainland < 0) return { ok: false, reason: `${bodyName} has no land to settle` }
  if (hostileWarshipsAt(ship.ownerId, bodyName, useShipStore.getState().ships, atWar).length > 0) return { ok: false, reason: 'Enemy warships hold the orbit' }
  if ((ship.settlers ?? 0) <= 0) return { ok: false, reason: 'The ship carries no settlers' }
  const cost = colonyCostFor(ship.ownerId, bodyName)
  const influence = useResourceStore.getState().stateFor(ship.ownerId).amounts.influence ?? 0
  if (influence < cost) return { ok: false, reason: `Needs ${cost} influence (have ${Math.floor(influence)})` }
  return { ok: true, cost }
}

// The `colonize` command landing: the ship starts founding a colony on the body
// it orbits (if it could found one now). The colony exists COLONY_FOUNDING_DAYS
// later (resolveFoundings); Influence is paid then.
export function startFounding(shipId: string, bodyName: string, simDays: number): boolean {
  const ship = useShipStore.getState().ships.find((s) => s.id === shipId)
  if (!ship || ship.founding?.bodyName === bodyName) return false
  if (!canColonize(ship, bodyName).ok) return false
  useShipStore.getState().setFounding(shipId, { bodyName, sinceSimDays: simDays })
  return true
}

// Every Colony Ship at work: abandoned if it can no longer found the colony
// (it left, enemy warships took the orbit, someone else claimed the world, …),
// founded once COLONY_FOUNDING_DAYS have passed.
export function resolveFoundings(simDays: number): void {
  for (const ship of useShipStore.getState().ships) {
    const f = ship.founding
    if (!f) continue
    const check: ColonizeResult = ship.order ? { ok: false, reason: 'the ship left orbit' } : canColonize(ship, f.bodyName)
    if (!check.ok) {
      useShipStore.getState().setFounding(ship.id, null)
      useDiplomacyStore.getState().pushEvent('colony-abandoned', [ship.ownerId], `${nameOf(ship.ownerId)} abandoned founding a colony on ${f.bodyName}: ${check.reason}`, simDays, { bodyName: f.bodyName })
      continue
    }
    if (simDays - f.sinceSimDays >= COLONY_FOUNDING_DAYS) foundColony(ship.id, f.bodyName, simDays)
  }
}

// The founding finished: the ship's settlers found a micro-colony on
// `bodyName` (the body it orbits), and the ship is used up.
export function foundColony(shipId: string, bodyName: string, simDays: number): boolean {
  const ship = useShipStore.getState().ships.find((s) => s.id === shipId)
  if (!ship) return false
  const check = canColonize(ship, bodyName)
  if (!check.ok) return false
  const owner = ship.ownerId
  useResourceStore.getState().addAmount(owner, 'influence', -check.cost)
  useTerritoryStore.getState().claimBody(bodyName, owner)
  useAbstractEconomyStore.getState().addColonyWorld(bodyName, ship.settlers ?? 0, Math.min(landForBody(bodyName), MICRO_COLONY_LAND))
  const surface = groundSurface(bodyName, useTerritoryStore.getState().bodyOwner)
  const outpostNode = surface ? placeOutpostNode(surface) : null
  if (outpostNode !== null) {
    useColonyStore.getState().addColony({ bodyName, outpostNode, stage: 'micro', foundedSimDays: simDays, orbitSecureSinceSimDays: null })
    useArmyStore.getState().addArmy({ ownerId: owner, kind: 'garrison', location: { kind: 'body', bodyName }, anchorNode: outpostNode })
  }
  useShipStore.getState().removeShip(shipId)
  useDiplomacyStore.getState().pushEvent('colony-founded', [owner], `${nameOf(owner)} founded a colony on ${bodyName}`, simDays, { bodyName })
  return true
}

// A Colony Ship just built takes its settlers from its capital's population
// (Simple mode, which is where colonies exist).
export function embarkSettlers(shipId: string, countryId: string): void {
  const capacity = resolveShipClass(useShipStore.getState().ships.find((s) => s.id === shipId)?.classId ?? '')?.settlerCapacity ?? 0
  if (capacity <= 0 || !isAbstractEconomy()) return
  const capital = getCountry(countryId)?.capitalBodyName ?? COUNTRIES.find((c) => c.id === countryId)?.capitalBodyName
  const world = capital ? useAbstractEconomyStore.getState().worlds[capital] : undefined
  if (!capital || !world) return
  const taken = Math.max(0, Math.min(capacity, world.population - SETTLER_SOURCE_FLOOR))
  if (taken <= 0) return
  useAbstractEconomyStore.getState().adjustPopulation(capital, -taken)
  useShipStore.getState().setSettlers(shipId, taken)
}

// The player's "Colonize" order for the selected Colony Ships: at once if one
// already orbits the body, else it flies there and founds it on arrival.
export function orderSelectedToColonize(systemId: string, bodyName: string): void {
  const store = useShipStore.getState()
  const ships = store.ships.filter((s) => store.selectedShipIds.includes(s.id) && isPlayerOwned(s) && resolveShipClass(s.classId)?.role === 'colony')
  const ship = ships.find((s) => canColonize(s, bodyName, { anywhere: true }).ok)
  if (!ship) return
  if (orbitedBody(ship) === bodyName) {
    queueShipCommand(ship.id, { kind: 'colonize', bodyName })
    return
  }
  store.setArrivalCommand(ship.id, { starId: systemId, bodyName, command: { kind: 'colonize', bodyName } })
  queueMoveOrder(ship, { kind: 'body', systemId, bodyName })
}
