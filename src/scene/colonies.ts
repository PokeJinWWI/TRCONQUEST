// Colonies and Influence, store side: founding a colony from a Colony Ship,
// the seeded colonies, settlers and the monthly Influence. The rules are pure in
// scene/colonyLogic.ts; hooks/useColonyResolver.ts promotes micro-colonies.
import { seededStream } from '../data/galaxyGen'
import type { SettlerMix } from '../economy/settlerPicker'
import { decideConstructionNow, strengthenBySettlementNow } from './sovereignty'
import { locationsOf } from './locations'
import { rivalPlanetClaim } from './planetClaim'
import { simpleColonyKit } from '../economy-abstract/colonyKit'
import { bodyGroundInfoAny } from './planetTerrain'
import { OUTPOST_SEED } from '../data/simplisticEconomyData'
import { planLanding, type Landing } from './landingSite'
import { foundSite } from './siteFoundingOrders'
import { arc, nodePoint } from './surfaceMesh'
import { seedColonyWorld } from '../economy/colonySeed'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { siteOwner, useLocationStore } from '../state/locationStore'
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
import { useViewStore } from '../state/viewStore'
import { useGroundViewStore } from '../state/groundViewStore'
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
import { isBodySurveyed, knownSurveyedBodies, restingStarId, systemOfShip } from './surveyLogic'
import { useStarbaseStore } from '../state/starbaseStore'
import { recordEncroachments } from './encroachment'
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

// Complex mode starts with a handful of big worlds, while every other body a nation owns at the start (Phobos, Deimos, Orion's
// outer worlds, ...) is an outpost with an economy in Simple mode (OUTPOST_SEED). Complex gives them the same: a standalone world
// of the same size, run like any colony (the kit of its planet class), so each has Districts, Population and the Build Lens in both modes.
export function seedOutpostWorlds(): string[] {
  const owners = useTerritoryStore.getState().bodyOwner
  const added: string[] = []
  for (const [bodyName, ownerId] of Object.entries(owners)) {
    const capital = getCountry(ownerId)?.capitalBodyName
    const worlds = useEconomyStore.getState().worlds
    if (worldByName(worlds, bodyName) || !capital) continue
    const home = worldByName(worlds, capital)
    const world = home ? seedColonyWorld({ bodyName, ownerId, settlers: OUTPOST_SEED.population, home, landLimit: landForBody(bodyName) }) : null
    if (!world) continue
    useEconomyStore.getState().addWorld(world)
    added.push(bodyName)
  }
  return added
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

// A nation's own home system (its capital's star).
export function isHomeSystem(nationId: string, starId: string): boolean {
  return getCountry(nationId)?.capitalStarId === starId
}

// Founding a colony costs no Influence and needs no Starbase: settlers, a surveyed free world and time.
export type ColonizeResult = { ok: true } | { ok: false; reason: string }

// Whether this Colony Ship could found a colony on `bodyName` now.
// `anywhere` skips "must be in orbit there" (for a menu that flies it there).
export function canColonize(ship: ShipInstance, bodyName: string, opts: { anywhere?: boolean } = {}): ColonizeResult {
  if (resolveShipClass(ship.classId)?.role !== 'colony') return { ok: false, reason: 'Only a Colony Ship can found a colony' }
  if (!opts.anywhere && orbitedBody(ship) !== bodyName) return { ok: false, reason: `The ship must be in orbit of ${bodyName}` }
  // The one survey rule (a nation knows the bodies of a system it owns a world in).
  if (!isBodySurveyed(useSurveyStore.getState().discovered[ship.ownerId], ship.ownerId, bodyName, useTerritoryStore.getState().bodyOwner)) return { ok: false, reason: `Survey ${bodyName} first` }
  if (!bodyStarId(bodyName)) return { ok: false, reason: 'Unknown world' }
  const owner = useTerritoryStore.getState().bodyOwner[bodyName]
  // A planet someone has claimed (scene/planetClaim.ts) takes no other colony.
  const rival = rivalPlanetClaim(bodyName, ship.ownerId)
  if (!owner && rival) return { ok: false, reason: `${nameOf(rival.claimantId)} has claimed ${bodyName}` }
  if (owner) return { ok: false, reason: owner === ship.ownerId ? `You already hold ${bodyName}` : `${nameOf(owner)} already holds ${bodyName}` }
  // Who may settle HERE is a question of jurisdiction at the place, not of who is nearest (scene/sovereignty.ts).
  const rights = decideConstructionNow(ship.ownerId, { kind: 'body', id: bodyName }, 'colony')
  if (!rights.allowed) return { ok: false, reason: rights.reason }
  const surface = groundSurface(bodyName, useTerritoryStore.getState().bodyOwner)
  if (!surface || surface.mainland < 0) return { ok: false, reason: `${bodyName} has no land to settle` }
  if (hostileWarshipsAt(ship.ownerId, bodyName, useShipStore.getState().ships, atWar).length > 0) return { ok: false, reason: 'Enemy warships hold the orbit' }
  if ((ship.settlers ?? 0) <= 0) return { ok: false, reason: 'The ship carries no settlers' }
  return { ok: true }
}

// The `colonize` command landing: the ship starts founding a colony on the body
// it orbits (if it could found one now). The colony exists COLONY_FOUNDING_DAYS
// later (resolveFoundings).
export function startFounding(shipId: string, bodyName: string, simDays: number, node?: number): boolean {
  const ship = useShipStore.getState().ships.find((s) => s.id === shipId)
  if (!ship || ship.founding?.bodyName === bodyName) return false
  if (!canColonize(ship, bodyName).ok) return false
  // A landing the player chose has to still be open.
  if (node !== undefined && !planLanding(bodyName, node, ship.ownerId).ok) return false
  useShipStore.getState().setFounding(shipId, { bodyName, sinceSimDays: simDays, ...(node !== undefined ? { node } : {}) })
  return true
}

// Every Colony Ship at work: abandoned if it can no longer found the colony
// (it left, enemy warships took the orbit, someone else claimed the world, …),
// founded once COLONY_FOUNDING_DAYS have passed.
export function resolveFoundings(simDays: number): void {
  for (const ship of useShipStore.getState().ships) {
    const f = ship.founding
    if (!f) continue
    let check: ColonizeResult = ship.order ? { ok: false, reason: 'the ship left orbit' } : canColonize(ship, f.bodyName)
    if (check.ok && f.node !== undefined) {
      const landing = planLanding(f.bodyName, f.node, ship.ownerId)
      if (!landing.ok) check = { ok: false, reason: `the landing site is no longer open (${landing.reason.toLowerCase()})` }
    }
    if (!check.ok) {
      useShipStore.getState().setFounding(ship.id, null)
      useDiplomacyStore.getState().pushEvent('colony-abandoned', [ship.ownerId], `${nameOf(ship.ownerId)} abandoned founding a colony on ${f.bodyName}: ${check.reason}`, simDays, { bodyName: f.bodyName })
      continue
    }
    if (simDays - f.sinceSimDays >= COLONY_FOUNDING_DAYS) foundColony(ship.id, f.bodyName, simDays, f.node)
  }
}

// The founding finished: the ship's settlers found a micro-colony on
// `bodyName` (the body it orbits), and the ship is used up.
export function foundColony(shipId: string, bodyName: string, simDays: number, landingNode?: number): boolean {
  const ship = useShipStore.getState().ships.find((s) => s.id === shipId)
  if (!ship) return false
  const check = canColonize(ship, bodyName)
  if (!check.ok) return false
  const owner = ship.ownerId
  const economy = colonyWorldFor(owner, bodyName, ship.settlers ?? 0, ship.settlerMix)
  if (!economy) return false
  // Inside someone else's borders: allowed, at a diplomatic cost (scene/encroachment.ts).
  const colonyStar = bodyStarId(bodyName)
  if (colonyStar) recordEncroachments(owner, colonyStar, 'colony', simDays, useStarbaseStore.getState().starbases)
  useTerritoryStore.getState().claimBody(bodyName, owner)
  economy()
  const surface = groundSurface(bodyName, useTerritoryStore.getState().bodyOwner)
  // Where it lands: the spot the player chose (a free site nearby is taken, else a new settlement site is founded there),
  // or, with none chosen (the AI, auto-settle), the first open ground near the body's capital or cities.
  const landing = landingNode !== undefined ? planLanding(bodyName, landingNode, owner) : null
  const outpostNode = landing?.ok ? landing.node : surface ? placeOutpostNode(surface) : null
  // The colony is a PLACE: a settlement site on the body, established for its nation, with a
  // settlement claim over the site and the ground around it (scene/sovereignty.ts).
  const siteId = outpostNode === null ? undefined : landing?.ok ? establishLandingSite(owner, bodyName, landing, simDays) : establishColonySite(owner, bodyName, outpostNode, simDays)
  if (outpostNode !== null) {
    useColonyStore.getState().addColony({ bodyName, outpostNode, stage: 'micro', foundedSimDays: simDays, orbitSecureSinceSimDays: null, ...(siteId ? { siteId } : {}) })
    useArmyStore.getState().addArmy({ ownerId: owner, kind: 'garrison', location: { kind: 'body', bodyName }, anchorNode: outpostNode })
  }
  useShipStore.getState().removeShip(shipId)
  useDiplomacyStore.getState().pushEvent('colony-founded', [owner], `${nameOf(owner)} founded a colony on ${bodyName}`, simDays, { bodyName })
  return true
}

const simpleColonyKitFor = (bodyName: string) => {
  const info = bodyGroundInfoAny(bodyName)
  return info ? simpleColonyKit(info.planetClass) : undefined
}

// How a colony's people enter the nation's economy, in whichever mode is running: null if they
// cannot (Complex mode with no capital world to take its culture from); otherwise the call that
// adds the world. The same founding in both modes (docs/territorial-design.md section 3).
function colonyWorldFor(owner: string, bodyName: string, settlers: number, mix?: SettlerMix): (() => void) | null {
  if (isAbstractEconomy()) return () => useAbstractEconomyStore.getState().addColonyWorld(bodyName, settlers, Math.min(landForBody(bodyName), MICRO_COLONY_LAND), simpleColonyKitFor(bodyName))
  const capital = getCountry(owner)?.capitalBodyName
  const home = capital ? worldByName(useEconomyStore.getState().worlds, capital) : undefined
  const world = home ? seedColonyWorld({ bodyName, ownerId: owner, settlers, home, mix }) : null
  return world ? () => useEconomyStore.getState().addWorld(world) : null
}

// The settlement site a new colony stands on: the free one nearest its outpost (the body's own
// first one if the body has none near). Establishes it for the nation and files the settlement
// claim; undefined for a body with no settlement site (which then has no claim either).
function establishColonySite(owner: string, bodyName: string, outpostNode: number, simDays: number): string | undefined {
  const free = locationsOf(bodyName).filter((l) => l.kind === 'settlement' && (!siteOwner(l.id) || siteOwner(l.id) === owner))
  if (free.length === 0) return undefined
  const here = nodePoint(outpostNode)
  const site = [...free].sort((a, b) => arc(nodePoint(a.node!), here) - arc(nodePoint(b.node!), here) || a.id.localeCompare(b.id))[0]
  if (!useLocationStore.getState().establish(site.id, owner, simDays)) return undefined
  strengthenBySettlementNow(owner, site.id, simDays)
  return site.id
}

// The site of a chosen landing: a free generated one is established as it is, a new one is founded first.
function establishLandingSite(owner: string, bodyName: string, landing: Extract<Landing, { ok: true }>, simDays: number): string | undefined {
  let site = landing.adopt
  if (landing.found) {
    const founded = foundSite(owner, bodyName, 'settlement', landing.node, simDays)
    if (!founded.ok) return establishColonySite(owner, bodyName, landing.node, simDays)
    site = founded.site
  }
  if (!site) return undefined
  if (!useLocationStore.getState().establish(site.id, owner, simDays)) return undefined
  strengthenBySettlementNow(owner, site.id, simDays)
  return site.id
}

// A Colony Ship just built takes its settlers from one of its nation's worlds (the one chosen when it was queued, else the
// capital): real pops, drawn across the professions with the emphasis on the working classes (economy/settlerPicker.ts).
// Either mode: the same number of people leave that world.
export function embarkSettlers(shipId: string, countryId: string, sourceBody?: string): void {
  const capacity = resolveShipClass(useShipStore.getState().ships.find((s) => s.id === shipId)?.classId ?? '')?.settlerCapacity ?? 0
  if (capacity <= 0) return
  const capital = getCountry(countryId)?.capitalBodyName ?? COUNTRIES.find((c) => c.id === countryId)?.capitalBodyName
  // A source that is no longer the nation's own falls back to the capital.
  const own = sourceBody && useTerritoryStore.getState().bodyOwner[sourceBody] === countryId ? sourceBody : capital
  if (!own) return
  let taken = 0
  let mix: SettlerMix | undefined
  if (isAbstractEconomy()) {
    const world = useAbstractEconomyStore.getState().worlds[own]
    if (!world) return
    taken = Math.max(0, Math.min(capacity, world.population - SETTLER_SOURCE_FLOOR))
    if (taken > 0) useAbstractEconomyStore.getState().adjustPopulation(own, -taken)
  } else {
    const r = useEconomyStore.getState().takeSettlers(own, capacity, SETTLER_SOURCE_FLOOR, seededStream(1, `settlers:${shipId}`))
    taken = r.taken
    mix = r.mix
  }
  if (taken > 0) useShipStore.getState().setSettlers(shipId, taken, mix)
}

// The worlds a nation's Colony Ship could take its settlers from, with the people each holds (millions), biggest first. A world
// never gives settlers below SETTLER_SOURCE_FLOOR, so one under it is not offered.
export function settlerSourceWorlds(countryId: string): { bodyName: string; population: number }[] {
  const owners = useTerritoryStore.getState().bodyOwner
  const rows = isAbstractEconomy()
    ? Object.values(useAbstractEconomyStore.getState().worlds).map((w) => ({ bodyName: w.bodyName, population: w.population }))
    : useEconomyStore.getState().worlds.map((w) => ({ bodyName: w.id, population: w.pops.reduce((n, p) => n + p.populationSize, 0) }))
  return rows.filter((r) => owners[r.bodyName] === countryId && r.population > SETTLER_SOURCE_FLOOR).sort((a, b) => b.population - a.population || a.bodyName.localeCompare(b.bodyName))
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
  if (ship) chooseLanding(ship, systemId, bodyName)
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
  chooseLanding(pick.s, systemId, bodyName)
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

// The chooser's list: worlds grouped by named system, the ship's own system first.
export function colonizeGroups(ship: ShipInstance): ChooserGroup[] {
  const worlds = colonizeWorlds(ship)
  const here = systemOfShip(ship) ?? restingStarId(ship)
  return groupColonizeWorlds({ worlds, hereStarId: here, homeStarId: getCountry(ship.ownerId)?.capitalStarId ?? null, starName: (id) => findStar(id)?.name ?? id })
}

// Why a Colony Ship has nothing to settle where it is (the line in its panel).
export function nothingHereText(ship: ShipInstance): string {
  const starId = systemOfShip(ship) ?? restingStarId(ship)
  const orbit = orbitedBody(ship)
  const owners = useTerritoryStore.getState().bodyOwner
  return nothingHereReason({
    systemName: (starId ? findStar(starId)?.name : undefined) ?? 'this system',
    hasSettlers: (ship.settlers ?? 0) > 0,
    orbit: !orbit ? 'none' : !owners[orbit] && (groundSurface(orbit, owners)?.mainland ?? -1) >= 0 ? 'settleable' : 'not',
  })
}

// The player's colonize choice: the ground map of the world opens so the landing can be picked (scene/colonies.completeLanding).
export function chooseLanding(ship: ShipInstance, systemId: string, bodyName: string): void {
  useViewStore.getState().enterGround(bodyName)
  useGroundViewStore.getState().setMode({ kind: 'colonize', shipId: ship.id, systemId })
}

// A click on the ground map while choosing a landing: orders the ship there (or says why not).
export function completeLanding(bodyName: string, node: number, shipId: string, systemId: string): { ok: true } | { ok: false; reason: string } {
  const ship = useShipStore.getState().ships.find((s) => s.id === shipId)
  if (!ship) return { ok: false, reason: 'That Colony Ship is gone' }
  const check = canColonize(ship, bodyName, { anywhere: true })
  if (!check.ok) return check
  const landing = planLanding(bodyName, node, ship.ownerId)
  if (!landing.ok) return landing
  useShipStore.getState().setAutomation(ship.id, null)
  sendToColonize(ship, systemId, bodyName, landing.node)
  return { ok: true }
}

export function sendToColonize(ship: ShipInstance, systemId: string, bodyName: string, node?: number): void {
  const command = { kind: 'colonize' as const, bodyName, ...(node !== undefined ? { node } : {}) }
  if (orbitedBody(ship) === bodyName) {
    queueShipCommand(ship.id, command)
    return
  }
  const destination = { kind: 'body' as const, systemId, bodyName }
  // The arrival command is set only once the order is given (a risky jump asks first).
  confirmRiskyJump([ship], destination, () => {
    useShipStore.getState().setArrivalCommand(ship.id, { starId: systemId, bodyName, command })
    queueMoveOrder(ship, destination)
  })
}

// A game saved before colonies stood on sites (docs/territorial-design.md M13): every colony gets the settlement site
// nearest its outpost, established for its owner, with its settlement claim. Body ownership is left exactly as it was
// saved: it was recognized body-wide sovereignty before and stays so, and nothing is widened to a system.
export function upgradeLegacyColonies(simDays: number): number {
  let upgraded = 0
  const { colonies, setColonies } = useColonyStore.getState()
  const next = { ...colonies }
  for (const [body, colony] of Object.entries(colonies)) {
    const owner = useTerritoryStore.getState().bodyOwner[body]
    if (colony.siteId || !owner) continue
    const siteId = establishColonySite(owner, body, colony.outpostNode, simDays)
    if (!siteId) continue
    next[body] = { ...colony, siteId }
    upgraded++
  }
  if (upgraded > 0) setColonies(next)
  return upgraded
}
