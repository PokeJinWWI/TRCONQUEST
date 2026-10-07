// Colonies and Influence, store side: founding a colony from a Colony Ship,
// the seeded colonies, settlers and the monthly Influence. The rules are pure in
// scene/colonyLogic.ts; hooks/useColonyResolver.ts promotes micro-colonies.
import { confirmRiskyJump } from './jumpConfirm'
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
import { lightYearsBetween, placeOutpostNode } from './colonyLogic'
import { queueMoveOrder } from './commsVisual'
import { groundSurface } from './groundLogic'
import { queueShipCommand } from './shipCommands'
import { bodyStarId, systemBodies } from './territory'
import { groupColonizeWorlds, nothingHereReason, type ChooserGroup, type ChooserWorld } from './colonyChooser'
import { formatDate, simDaysToDate } from '../state/gameTimeStore'
import { isBodySurveyed, knownSurveyedBodies, restingStarId, systemOfShip } from './surveyLogic'
import { starbaseOwnersOf } from './starbaseLogic'
import { useStarbaseStore } from '../state/starbaseStore'
import { recordEncroachments } from './encroachment'
import { useGameTimeStore } from '../state/gameTimeStore'
import { findStar } from '../data/starData'

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

// A nation's own home system (its capital's star) needs no Starbase to colonize in: the
// Starbase rule is for claiming ground abroad.
export function isHomeSystem(nationId: string, starId: string): boolean {
  return getCountry(nationId)?.capitalStarId === starId
}

// Founding a colony costs no Influence (only a Starbase in the system unless it is the nation's home system, settlers and time).
export type ColonizeResult = { ok: true } | { ok: false; reason: string }

// Whether this Colony Ship could found a colony on `bodyName` now.
// `anywhere` skips "must be in orbit there" (for a menu that flies it there).
export function canColonize(ship: ShipInstance, bodyName: string, opts: { anywhere?: boolean } = {}): ColonizeResult {
  if (!isAbstractEconomy()) return { ok: false, reason: 'Colonies need Simple economy mode for now' }
  if (resolveShipClass(ship.classId)?.role !== 'colony') return { ok: false, reason: 'Only a Colony Ship can found a colony' }
  if (!opts.anywhere && orbitedBody(ship) !== bodyName) return { ok: false, reason: `The ship must be in orbit of ${bodyName}` }
  // The one survey rule (a nation knows the bodies of a system it owns a world in).
  if (!isBodySurveyed(useSurveyStore.getState().discovered[ship.ownerId], ship.ownerId, bodyName, useTerritoryStore.getState().bodyOwner)) return { ok: false, reason: `Survey ${bodyName} first` }
  const starId = bodyStarId(bodyName)
  if (!starId || !(isHomeSystem(ship.ownerId, starId) || starbaseOwnersOf(starId, useStarbaseStore.getState().starbases, useGameTimeStore.getState().simDays).includes(ship.ownerId))) {
    return { ok: false, reason: `Needs a Starbase of your own in ${(starId ? findStar(starId)?.name : undefined) ?? 'that system'}` }
  }
  const owner = useTerritoryStore.getState().bodyOwner[bodyName]
  if (owner) return { ok: false, reason: owner === ship.ownerId ? `You already hold ${bodyName}` : `${nameOf(owner)} already holds ${bodyName}` }
  const surface = groundSurface(bodyName, useTerritoryStore.getState().bodyOwner)
  if (!surface || surface.mainland < 0) return { ok: false, reason: `${bodyName} has no land to settle` }
  if (hostileWarshipsAt(ship.ownerId, bodyName, useShipStore.getState().ships, atWar).length > 0) return { ok: false, reason: 'Enemy warships hold the orbit' }
  if ((ship.settlers ?? 0) <= 0) return { ok: false, reason: 'The ship carries no settlers' }
  return { ok: true }
}

// The `colonize` command landing: the ship starts founding a colony on the body
// it orbits (if it could found one now). The colony exists COLONY_FOUNDING_DAYS
// later (resolveFoundings).
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
  // Inside someone else's borders: allowed, at a diplomatic cost (scene/encroachment.ts).
  const colonyStar = bodyStarId(bodyName)
  if (colonyStar) recordEncroachments(owner, colonyStar, 'colony', simDays, useStarbaseStore.getState().starbases)
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

// A Colony Ship placed by a cheat (the Debug Console, the Sandbox panel) comes with
// a full load of settlers, taken from nowhere: it was not built at a yard, so nothing
// embarked them, and without settlers it could never found a colony.
export function loadSettlersFree(shipId: string): void {
  const capacity = resolveShipClass(useShipStore.getState().ships.find((s) => s.id === shipId)?.classId ?? '')?.settlerCapacity ?? 0
  if (capacity > 0) useShipStore.getState().setSettlers(shipId, capacity)
}

// The player's "Colonize" order for the selected Colony Ships: at once if one
// already orbits the body, else it flies there and founds it on arrival.
export function orderSelectedToColonize(systemId: string, bodyName: string): void {
  const store = useShipStore.getState()
  const ships = store.ships.filter((s) => store.selectedShipIds.includes(s.id) && isPlayerOwned(s) && resolveShipClass(s.classId)?.role === 'colony')
  const ship = ships.find((s) => canColonize(s, bodyName, { anywhere: true }).ok)
  if (ship) sendToColonize(ship, systemId, bodyName)
}

// Colonize from the planet menu: the player's own Colony Ship that can do it
// (one already at the body first, else any idle one) goes and does it. Says why
// when none can.
export function colonizeFromPlanet(bodyName: string): { ok: true; shipName: string } | { ok: false; reason: string } {
  const systemId = bodyStarId(bodyName)
  if (!systemId) return { ok: false, reason: 'Unknown world' }
  const mine = useShipStore.getState().ships.filter((s) => isPlayerOwned(s) && resolveShipClass(s.classId)?.role === 'colony')
  if (mine.length === 0) return { ok: false, reason: 'You have no Colony Ship: build one in the Shipyard (Science & support)' }
  const checks = mine.map((s) => ({ s, c: canColonize(s, bodyName, { anywhere: true }) }))
  const free = checks.filter((x) => x.c.ok && !x.s.founding && !x.s.arrivalCommand)
  const pick = free.find((x) => orbitedBody(x.s) === bodyName) ?? free[0]
  if (!pick) {
    const why = checks.find((x) => !x.c.ok)
    return { ok: false, reason: why && !why.c.ok ? why.c.reason : 'Your Colony Ships are all busy' }
  }
  sendToColonize(pick.s, systemId, bodyName)
  return { ok: true, shipName: pick.s.name }
}

// Worlds this Colony Ship could found a colony on now (what canColonize allows), with their
// system and distance from its capital. Worlds another Colony Ship is already headed for
// are left out. Each system's worlds come in the system's own order.
export function colonizeWorlds(ship: ShipInstance): ChooserWorld[] {
  const taken = new Set<string>()
  for (const o of useShipStore.getState().ships) {
    if (o.id === ship.id) continue
    if (o.founding) taken.add(o.founding.bodyName)
    if (o.arrivalCommand?.command.kind === 'colonize') taken.add(o.arrivalCommand.command.bodyName)
  }
  const capitalStar = getCountry(ship.ownerId)?.capitalStarId ?? 'sol'
  const out: ChooserWorld[] = []
  for (const bodyName of knownSurveyedBodies(useSurveyStore.getState().discovered[ship.ownerId], ship.ownerId, useTerritoryStore.getState().bodyOwner)) {
    if (taken.has(bodyName)) continue
    const starId = bodyStarId(bodyName)
    if (starId && canColonize(ship, bodyName, { anywhere: true }).ok) out.push({ bodyName, starId, ly: lightYearsBetween(capitalStar, starId) })
  }
  const order = (w: ChooserWorld) => systemBodies(w.starId).indexOf(w.bodyName)
  return out.sort((a, b) => a.ly - b.ly || a.starId.localeCompare(b.starId) || order(a) - order(b) || a.bodyName.localeCompare(b.bodyName))
}

export function colonizeCandidates(ship: ShipInstance): { bodyName: string }[] {
  return colonizeWorlds(ship).map(({ bodyName }) => ({ bodyName }))
}

// The nation's Starbases that are still being built: system and when each is done.
function buildingStarbases(nationId: string, simDays: number): { starId: string; readySimDays: number }[] {
  return useStarbaseStore.getState().starbases.filter((sb) => sb.ownerId === nationId && sb.readySimDays > simDays).map((sb) => ({ starId: sb.starId, readySimDays: sb.readySimDays }))
}

// The chooser's list: worlds grouped by named system, the ship's own system first, and
// the systems whose Starbase is still being built said so (no worlds can be offered there yet).
export function colonizeGroups(ship: ShipInstance): ChooserGroup[] {
  const simDays = useGameTimeStore.getState().simDays
  const worlds = colonizeWorlds(ship)
  const here = systemOfShip(ship) ?? restingStarId(ship)
  const withWorlds = new Set(worlds.map((w) => w.starId))
  const waiting = buildingStarbases(ship.ownerId, simDays)
    .filter((sb) => !withWorlds.has(sb.starId) && (here === sb.starId || systemBodies(sb.starId).some((b) => isBodySurveyed(useSurveyStore.getState().discovered[ship.ownerId], ship.ownerId, b, useTerritoryStore.getState().bodyOwner))))
    .map((sb) => ({ starId: sb.starId, readyText: formatDate(simDaysToDate(sb.readySimDays)) }))
  return groupColonizeWorlds({ worlds, waiting, hereStarId: here, homeStarId: getCountry(ship.ownerId)?.capitalStarId ?? null, starName: (id) => findStar(id)?.name ?? id })
}

// Why a Colony Ship has nothing to settle where it is (the line in its panel).
export function nothingHereText(ship: ShipInstance): string {
  const simDays = useGameTimeStore.getState().simDays
  const starId = systemOfShip(ship) ?? restingStarId(ship)
  const orbit = orbitedBody(ship)
  const mine = starId ? useStarbaseStore.getState().starbases.filter((sb) => sb.starId === starId && sb.ownerId === ship.ownerId) : []
  const building = mine.find((sb) => sb.readySimDays > simDays)
  const owners = useTerritoryStore.getState().bodyOwner
  return nothingHereReason({
    systemName: (starId ? findStar(starId)?.name : undefined) ?? 'this system',
    starbase: mine.some((sb) => sb.readySimDays <= simDays) ? 'finished' : building ? 'building' : 'none',
    readyText: building ? formatDate(simDaysToDate(building.readySimDays)) : undefined,
    isHomeSystem: !!starId && isHomeSystem(ship.ownerId, starId),
    hasSettlers: (ship.settlers ?? 0) > 0,
    orbit: !orbit ? 'none' : !owners[orbit] && (groundSurface(orbit, owners)?.mainland ?? -1) >= 0 ? 'settleable' : 'not',
  })
}

export function sendToColonize(ship: ShipInstance, systemId: string, bodyName: string): void {
  if (orbitedBody(ship) === bodyName) {
    queueShipCommand(ship.id, { kind: 'colonize', bodyName })
    return
  }
  const destination = { kind: 'body' as const, systemId, bodyName }
  // The arrival command is set only once the order is given (a risky jump asks first).
  confirmRiskyJump([ship], destination, () => {
    useShipStore.getState().setArrivalCommand(ship.id, { starId: systemId, bodyName, command: { kind: 'colonize', bodyName } })
    queueMoveOrder(ship, destination)
  })
}
