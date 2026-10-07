// Travel into another cluster and settling there (scene/clusters.ts, shipPhysics,
// territory.bodyInfoOf, starbaseStore, colonies): a ship arrives at the cluster's
// entry point, flies among ITS stars by the ordinary interstellar rules, and builds
// a Starbase and a colony there by the same checks as at home.
// Run: npx tsx tests/foreignCluster.test.ts
import { SOLAR_NEIGHBORHOOD_ID, clusterOfGeneratedStar } from '../src/data/galaxyGen'
import { NEIGHBORHOODS } from '../src/data/neighborhoodData'
import { STARS, findStar, findSystemStar, getStarsForNeighborhood } from '../src/data/starData'
import { getPlanetsForStar } from '../src/scene/planetData'
import { clusterOfDestination, clusterOfStar, shipClusterId, starsOfShipCluster } from '../src/scene/clusters'
import { applyMoveResult, commsDelayToLocation } from '../src/scene/commsVisual'
import { clusterOfInfo, clusterScenePosition, galacticPosition, getShipRenderPosition, hyperdriveJumpChance, isShipInGalacticSpace, planMove, planMoveUnchecked, reachabilityBlock, setJumpRoll, shipPlaceLabel } from '../src/scene/shipPhysics'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { bodyIndex, bodyInfoOf, bodyStarId, systemBodies } from '../src/scene/territory'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore, type MoveDestination } from '../src/state/shipStore'
import { useTechStore, DEFAULT_RESEARCHED } from '../src/state/techStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { canBuildStarbase, starbaseInfluenceCostFor, useStarbaseStore } from '../src/state/starbaseStore'
import { readFileSync } from 'node:fs'
import { COLONY_FOUNDING_DAYS } from '../src/data/colonyData'
import { OPINION_ON_ENCROACHMENT } from '../src/data/diplomacyData'
import { galaxyEmpires } from '../src/data/generatedEmpires'
import { ownerInfoOf } from '../src/data/ownerInfo'
import { STARBASE_BUILD_DAYS, STARBASE_COST, STARBASE_INFLUENCE_COST, STARBASE_INFLUENCE_PER_KLY } from '../src/data/starbaseData'
import { klyBetweenClusters } from '../src/scene/clusters'
import { canColonize, resolveFoundings, startFounding } from '../src/scene/colonies'
import { UNKNOWN_EMPIRE_ID, encroachedOwners, ownersPresent, recordEncroachments, shownClaim } from '../src/scene/encroachment'
import { groundSurface } from '../src/scene/groundLogic'
import { nearestStation } from '../src/scene/refill'
import { starbaseInfluenceCost, starbaseOwnersOf } from '../src/scene/starbaseLogic'
import { systemClaim } from '../src/scene/territory'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useColonyStore } from '../src/state/colonyStore'
import { relationIn as relationOf, useDiplomacyStore } from '../src/state/diplomacyStore'
import { useResourceStore } from '../src/state/resourceStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const VENUS = 'republic-of-venus'
const home = NEIGHBORHOODS.find((n) => n.id === SOLAR_NEIGHBORHOOD_ID)!
const kly = (a: { position: [number, number, number] }, b: { position: [number, number, number] }) => Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2])
const byDistance = NEIGHBORHOODS.filter((n) => n.id !== home.id).sort((a, b) => kly(a, home) - kly(b, home))
const NEAR = byDistance[0].id
const FAR = byDistance[1].id
const nearStars = getStarsForNeighborhood(NEAR)
const withPlanets = nearStars.filter((s) => getPlanetsForStar(s.id).length > 0)
const A = withPlanets[0]
const B = withPlanets[1]
const ship = (id: string) => useShipStore.getState().ships.find((s) => s.id === id)!
let day = 100
function fresh() {
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  day = 100
  useGameTimeStore.setState({ simDays: day, paused: false })
  useShipStore.setState({ ships: [] })
  useHyperlaneStore.setState({ lanes: {} })
  useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
  useStarbaseStore.setState({ starbases: [] })
  useTerritoryStore.getState().reset()
  useTechStore.setState({ byCountry: {} })
  setJumpRoll(() => 1)
}
// Orders a ship by the player's own planner and applies the result; a jump is instant, a
// flight is run to its arrival. Each order is given after the drive's cooldown.
function go(id: string, destination: MoveDestination, planner = planMove) {
  day += 40
  useGameTimeStore.setState({ simDays: day })
  const result = planner(ship(id), destination, day)
  applyMoveResult(ship(id), destination, result)
  return result
}

console.log('\n=== 1. Stars, bodies and clusters ===')
{
  check('the nearest cluster has stars with planets to work with', !!A && !!B, `${byDistance[0].name}: ${nearStars.length} stars, ${withPlanets.length} with planets`)
  check('a star knows its cluster: ours, or a generated one', clusterOfStar('sol') === SOLAR_NEIGHBORHOOD_ID && clusterOfStar(A.id) === NEAR && clusterOfGeneratedStar(A.id) === NEAR)
  const planet = getPlanetsForStar(A.id)[0].name
  check('a generated planet is found by name, without the home index holding it', bodyStarId(planet) === A.id && bodyInfoOf(planet)?.kind === 'planet' && !bodyIndex().has(planet))
  check('...a name that is no planet of that star is not', bodyInfoOf(`${A.name} XIX`) === undefined && bodyInfoOf('Nowhere I') === undefined)
  check('home bodies are found as ever', bodyStarId('Mars') === 'sol' && bodyInfoOf('Luna')?.parentPlanet === 'Earth')
  check('a generated star is the one star of its own system', findSystemStar(A.name)?.name === A.name && findStar(A.id)?.id === A.id)
  check('its system lists its bodies', systemBodies(A.id).length === getPlanetsForStar(A.id).length)
  check('destinations know their cluster too', clusterOfDestination({ kind: 'star', starId: A.id }) === NEAR && clusterOfDestination({ kind: 'body', systemId: 'sol', bodyName: 'Mars' }) === SOLAR_NEIGHBORHOOD_ID && clusterOfDestination({ kind: 'cluster', clusterId: NEAR }) === null && clusterOfDestination({ kind: 'interstellar-point', position: [0, 0, 0] }) === SOLAR_NEIGHBORHOOD_ID)
}

console.log('\n=== 2. Arriving: the cluster\'s entry point, on its own interstellar map ===')
{
  fresh()
  const id = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  check('at home a ship is in the Solar Neighbourhood', shipClusterId(ship(id)) === SOLAR_NEIGHBORHOOD_ID)
  check('a star of another cluster cannot be ordered from home', planMove(ship(id), { kind: 'star', starId: A.id }, day).kind === 'unreachable', reachabilityBlock(ship(id), { kind: 'star', starId: A.id }, day) ?? '')
  const jump = go(id, { kind: 'cluster', clusterId: NEAR })
  check('the jump to the cluster succeeds and charts the cluster lane for its nation', jump.kind === 'instant' && useHyperlaneStore.getState().hasHyperlane(MARS, SOLAR_NEIGHBORHOOD_ID, NEAR))
  const loc = ship(id).location
  check('it lands at the entry point: a point of THAT cluster\'s interstellar map, near its origin', loc.kind === 'interstellar-point' && loc.clusterId === NEAR && Math.hypot(...loc.position) < 2, JSON.stringify(loc))
  const info = getShipRenderPosition(ship(id), day)
  check('...in interstellar space, no longer out between clusters', info.space === 'interstellar' && clusterOfInfo(info) === NEAR && !isShipInGalacticSpace(ship(id)) && shipClusterId(ship(id)) === NEAR)
  check('on the galactic map it stands at that cluster\'s point', galacticPosition(info).distanceTo(clusterScenePosition(NEAR)) < 1e-9)
  check('its place reads with the cluster\'s name', shipPlaceLabel(ship(id)).includes(byDistance[0].name), shipPlaceLabel(ship(id)))
  check('the stars it can fly among are that cluster\'s', starsOfShipCluster(ship(id)).length === nearStars.length && starsOfShipCluster(ship(id))[0].id === nearStars[0].id)
  check('the cluster it is in is no longer a destination', planMove(ship(id), { kind: 'cluster', clusterId: NEAR }, day + 40).kind === 'unreachable')

  console.log('\n=== 3. Flying among its stars, into its systems and orbits ===')
  const risk = hyperdriveJumpChance(ship(id), { kind: 'star', starId: A.id }, day + 40)
  check('a jump to one of its stars has an ordinary jump risk', risk !== null && risk > 0 && risk <= 1, `${((risk ?? 0) * 100).toFixed(1)}%`)
  const toA = go(id, { kind: 'star', starId: A.id })
  check('it jumps to a star of the cluster and enters its system', toA.kind === 'instant' && ship(id).location.kind === 'orbiting' && (ship(id).location as { systemId: string }).systemId === A.id, JSON.stringify(ship(id).location))
  check('...a jump from the entry point (no star to start from) charts no star lane', useHyperlaneStore.getState().lanesOf(MARS).length === 1)
  const planetB = getPlanetsForStar(B.id)[0].name
  const toB = go(id, { kind: 'body', systemId: B.id, bodyName: planetB })
  check('from one star it jumps straight into a world\'s orbit in another system', toB.kind === 'instant' && ship(id).location.kind === 'orbiting' && (ship(id).location as { bodyName: string }).bodyName === planetB)
  check('...charting the star-to-star lane inside the cluster, as jumps at home do', useHyperlaneStore.getState().hasHyperlane(MARS, A.id, B.id) && !useHyperlaneStore.getState().hasHyperlane(VENUS, A.id, B.id))
  const inSystem = getShipRenderPosition(ship(id), day)
  check('in that system: system space, the cluster still known', inSystem.space === 'system' && inSystem.systemId === B.id && clusterOfInfo(inSystem) === NEAR)
  const planets = getPlanetsForStar(B.id)
  if (planets.length > 1) {
    const flight = go(id, { kind: 'body', systemId: B.id, bodyName: planets[1].name })
    check('inside a system it flies on its reaction drive', flight.kind === 'order' && flight.order.space === 'system' && flight.order.systemId === B.id)
  }
  check('a star of the Solar Neighbourhood cannot be ordered from there', planMove(ship(id), { kind: 'star', starId: 'sirius' }, day + 40).kind === 'unreachable', reachabilityBlock(ship(id), { kind: 'star', starId: 'sirius' }, day + 40) ?? '')
  check('nor a star of a third cluster', planMove(ship(id), { kind: 'star', starId: getStarsForNeighborhood(FAR)[0].id }, day + 40).kind === 'unreachable')

  console.log('\n=== 4. Leaving: cluster to cluster, and home ===')
  useShipStore.getState().setShipLocation(id, { kind: 'orbiting', systemId: B.id, bodyName: planetB, periodDays: 20, phaseDeg: 0, inclinationDeg: 0 })
  const before = useHyperlaneStore.getState().lanesOf(MARS).length
  const onward = go(id, { kind: 'cluster', clusterId: FAR })
  check('from inside one cluster it jumps to another', onward.kind === 'instant' && shipClusterId(ship(id)) === FAR)
  check('...charting the lane between THOSE two clusters (not from Sol)', useHyperlaneStore.getState().hasHyperlane(MARS, NEAR, FAR) && !useHyperlaneStore.getState().hasHyperlane(MARS, SOLAR_NEIGHBORHOOD_ID, FAR) && useHyperlaneStore.getState().lanesOf(MARS).length === before + 1)
  const back = go(id, { kind: 'cluster', clusterId: SOLAR_NEIGHBORHOOD_ID })
  const homeLoc = ship(id).location
  check('home again it lands beside Sol exactly as before', back.kind === 'instant' && homeLoc.kind === 'interstellar-point' && homeLoc.clusterId === undefined && shipClusterId(ship(id)) === SOLAR_NEIGHBORHOOD_ID)
  check('...and may be ordered to our own stars again', planMove(ship(id), { kind: 'star', starId: 'sirius' }, day + 40).kind !== 'unreachable')

  console.log('\n=== 5. Comms: the same distance rule, cluster to cluster ===')
  const there: { kind: 'orbiting'; systemId: string; bodyName: string; periodDays: number; phaseDeg: number; inclinationDeg: number } = { kind: 'orbiting', systemId: B.id, bodyName: planetB, periodDays: 20, phaseDeg: 0, inclinationDeg: 0 }
  const warp = commsDelayToLocation(there, 'sol', 'Mars', day, 'warp')
  const light = commsDelayToLocation(there, 'sol', 'Mars', day, 'light')
  const hyper = commsDelayToLocation(there, 'sol', 'Mars', day, 'hyper')
  const years = (kly(byDistance[0], home) * 1000) / 500
  check('a signal to a ship in that cluster crosses the kly between the clusters', Math.abs(warp / 365.25 - years) / years < 0.02, `${(warp / 365.25).toFixed(2)} years at Warp Comms, ${kly(byDistance[0], home).toFixed(2)} kly`)
  check('...slower at light speed, instant with Hyper Comms', light > warp && hyper === 0)
  check('a ship at home is measured as before', commsDelayToLocation({ kind: 'star', starId: 'sirius', offset: [0, 0, 0] }, 'sol', 'Mars', day, 'warp') < 30)
  void STARS
  void planMoveUnchecked
  void DEFAULT_RESEARCHED
}

// --- Settling ---------------------------------------------------------------------
const surveyAll = (nation: string, starId: string) => {
  for (const body of systemBodies(starId)) useSurveyStore.getState().discover(nation, { kind: 'surveyed', bodyName: body }, 0, 0)
  useSurveyStore.getState().discover(nation, { kind: 'explored', starId }, 0, 0)
}
const grantTech = (nation: string, ...techs: string[]) =>
  useTechStore.setState((st) => ({ byCountry: { ...st.byCountry, [nation]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set([...DEFAULT_RESEARCHED, ...techs]) } } }))
const setInfluence = (nation: string, n: number) => useResourceStore.getState().addAmount(nation, 'influence', n - (useResourceStore.getState().stateFor(nation).amounts.influence ?? 0))
const influenceOf = (nation: string) => useResourceStore.getState().stateFor(nation).amounts.influence ?? 0
const restAt = (id: string, starId: string, bodyName?: string) =>
  useShipStore.getState().setShipLocation(id, { kind: 'orbiting', systemId: starId, bodyName: bodyName ?? findStar(starId)!.name, periodDays: 20, phaseDeg: 0, inclinationDeg: 0 })
// A world of the star a Colony Ship can settle (it has land).
const settleable = (starId: string) => getPlanetsForStar(starId).map((p) => p.name).find((b) => (groundSurface(b, {})?.mainland ?? -1) >= 0)
const colonyStar = withPlanets.find((s) => settleable(s.id))!
const nearKly = kly(byDistance[0], home)

console.log('\n=== 6. A Starbase abroad: the same checks as at home, influence by distance ===')
{
  fresh()
  useResourceStore.setState({ byCountry: {} })
  useColonyStore.setState({ colonies: {} })
  useDiplomacyStore.getState().reset()
  grantTech(MARS, 'orbital-construction')
  const builder = spawnOwnedShip('construction-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().setShipCargo(builder, { ...STARBASE_COST })
  const starbases = () => useStarbaseStore.getState().starbases
  check('at home a Starbase costs the base 30 influence', starbaseInfluenceCostFor(MARS, 'wolf-359', starbases()) === STARBASE_INFLUENCE_COST && STARBASE_INFLUENCE_COST === 30)
  const abroad = starbaseInfluenceCostFor(MARS, colonyStar.id, starbases())
  check('in the neighbouring cluster it costs 30 + 10 per thousand light-years from home', abroad === STARBASE_INFLUENCE_COST + Math.ceil(nearKly * STARBASE_INFLUENCE_PER_KLY) && STARBASE_INFLUENCE_PER_KLY === 10, `${abroad} at ${nearKly.toFixed(2)} kly`)
  check('the rule is pure: nearest foothold, nothing extra inside one', starbaseInfluenceCost('b', ['a'], () => 2.5) === 55 && starbaseInfluenceCost('b', ['a', 'c'], (x) => (x === 'a' ? 9 : 1)) === 40 && starbaseInfluenceCost('a', ['a', 'c'], () => 5) === 30)

  restAt(builder, colonyStar.id)
  setInfluence(MARS, 1000)
  check('unsurveyed, it is refused as at home', canBuildStarbase(MARS, colonyStar.id, starbases(), builder).ok === false, (canBuildStarbase(MARS, colonyStar.id, starbases(), builder) as { reason?: string }).reason ?? '')
  surveyAll(MARS, colonyStar.id)
  setInfluence(MARS, abroad - 1)
  const short = canBuildStarbase(MARS, colonyStar.id, starbases(), builder)
  check('one influence short of the distance cost, it is refused with that number', !short.ok && short.reason.includes(String(abroad)), short.ok ? '' : short.reason)
  setInfluence(MARS, abroad)
  check('with the influence, the survey, the kit and the ship there it may build', canBuildStarbase(MARS, colonyStar.id, starbases(), builder).ok)
  const homeClaims = JSON.stringify(STARS.map((st) => systemClaim(st.id, useTerritoryStore.getState().bodyOwner, starbaseOwnersOf(st.id, starbases(), 100))))
  const built = useStarbaseStore.getState().build(MARS, colonyStar.id, 100, builder)
  check('it builds, paying the distance cost', built.ok && influenceOf(MARS) === 0 && starbases().length === 1)
  check('the claim: nothing until the Starbase is finished, then the system is Mars\'s', systemClaim(colonyStar.id, useTerritoryStore.getState().bodyOwner, starbaseOwnersOf(colonyStar.id, starbases(), 100)).kind === 'unclaimed' && JSON.stringify(systemClaim(colonyStar.id, useTerritoryStore.getState().bodyOwner, starbaseOwnersOf(colonyStar.id, starbases(), 100 + STARBASE_BUILD_DAYS))) === JSON.stringify({ kind: 'owned', countryId: MARS }))
  check('...which is what the border bubble is drawn from', JSON.stringify(shownClaim(colonyStar.id, useTerritoryStore.getState().bodyOwner, starbaseOwnersOf(colonyStar.id, starbases(), 100 + STARBASE_BUILD_DAYS), false)) === JSON.stringify({ kind: 'owned', countryId: MARS }))
  check('the home cluster\'s claims are exactly what they were', homeClaims === JSON.stringify(STARS.map((st) => systemClaim(st.id, useTerritoryStore.getState().bodyOwner, starbaseOwnersOf(st.id, starbases(), 100 + STARBASE_BUILD_DAYS)))))
  check('with a base in that cluster, the next Starbase there costs the base 30 again', starbaseInfluenceCostFor(MARS, A.id === colonyStar.id ? B.id : A.id, starbases()) === STARBASE_INFLUENCE_COST)
  check('nobody was there: no encroachment', useDiplomacyStore.getState().encroachments.length === 0)

  console.log('\n=== 7. A colony abroad: a Starbase of your own first, a surveyed world with land ===')
  const world = settleable(colonyStar.id)!
  const colonist = spawnOwnedShip('colony-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().setSettlers(colonist, 20)
  restAt(colonist, colonyStar.id, world)
  useGameTimeStore.setState({ simDays: 120 })
  const early = canColonize(ship(colonist), world)
  check('before the Starbase is finished the colony is refused', !early.ok && early.reason.includes('Starbase'), early.ok ? '' : early.reason)
  useGameTimeStore.setState({ simDays: 100 + STARBASE_BUILD_DAYS + 1 })
  check('with the Starbase standing it may be founded', canColonize(ship(colonist), world).ok, (canColonize(ship(colonist), world) as { reason?: string }).reason ?? '')
  const otherStar = withPlanets.find((st) => st.id !== colonyStar.id && settleable(st.id))
  if (otherStar) {
    surveyAll(MARS, otherStar.id)
    const elsewhere = canColonize(ship(colonist), settleable(otherStar.id)!, { anywhere: true })
    check('a world of a system without a Starbase of yours is refused', !elsewhere.ok && elsewhere.reason.includes('Starbase'), elsewhere.ok ? '' : elsewhere.reason)
  }
  const start = 100 + STARBASE_BUILD_DAYS + 1
  check('the colonize command starts the founding', startFounding(colonist, world, start) && !!ship(colonist).founding)
  useGameTimeStore.setState({ simDays: start + COLONY_FOUNDING_DAYS })
  resolveFoundings(start + COLONY_FOUNDING_DAYS)
  check('after the founding days the colony exists and the world is Mars\'s', useTerritoryStore.getState().bodyOwner[world] === MARS && !!useColonyStore.getState().colonies[world] && !ship(colonist))
  check('...a micro-colony with its outpost and its world in the economy', useColonyStore.getState().colonies[world].stage === 'micro' && !!useAbstractEconomyStore.getState().worlds[world])
  check('the nearest world to refill at, for a ship in that cluster, is the new colony', nearestStation(ship(builder), useTerritoryStore.getState().bodyOwner, start + COLONY_FOUNDING_DAYS)?.bodyName === world)
  check('...and for a ship at home it is still a home world', bodyStarId(nearestStation(ship(spawnOwnedShip('cargo-ship', MARS, 'sol', 'Earth')!), useTerritoryStore.getState().bodyOwner, start + COLONY_FOUNDING_DAYS)!.bodyName) === 'sol')
}

console.log('\n=== 8. An empire\'s system: claimed by an unknown empire, building allowed, at a cost ===')
{
  const empire = [...galaxyEmpires()].sort((a, b) => klyBetweenClusters(SOLAR_NEIGHBORHOOD_ID, a.clusterId) - klyBetweenClusters(SOLAR_NEIGHBORHOOD_ID, b.clusterId))[0]
  const star = empire.ownedStarIds.find((sid) => getPlanetsForStar(sid).length > 0) ?? empire.ownedStarIds[0]
  fresh()
  useResourceStore.setState({ byCountry: {} })
  useDiplomacyStore.getState().reset()
  grantTech(MARS, 'orbital-construction')
  const owners = useTerritoryStore.getState().bodyOwner
  check('the nearest empire owns stars in its cluster', empire.ownedStarIds.length > 0 && clusterOfStar(star) === empire.clusterId, `${empire.name} in ${empire.clusterId}`)
  check('its system reads as claimed by an unknown empire', JSON.stringify(shownClaim(star, owners, [], false)) === JSON.stringify({ kind: 'owned', countryId: UNKNOWN_EMPIRE_ID }) && ownerInfoOf(UNKNOWN_EMPIRE_ID)?.name === 'Unknown empire')
  check('...and by its name in Observer mode', JSON.stringify(shownClaim(star, owners, [], true)) === JSON.stringify({ kind: 'owned', countryId: empire.id }))
  check('a star nobody owns reads unclaimed', shownClaim(colonyStar.id, owners, [], false).kind === 'unclaimed')
  check('everyone present there: the empire', ownersPresent(star, owners, [], empire.id).join() === empire.id && encroachedOwners(MARS, [empire.id]).join() === empire.id)
  if (getPlanetsForStar(star).length > 0) {
    const builder = spawnOwnedShip('construction-ship', MARS, 'sol', 'Mars')!
    useShipStore.getState().setShipCargo(builder, { ...STARBASE_COST })
    restAt(builder, star)
    surveyAll(MARS, star)
    setInfluence(MARS, 1000)
    check('building inside its borders is allowed', canBuildStarbase(MARS, star, [], builder).ok, (canBuildStarbase(MARS, star, [], builder) as { reason?: string }).reason ?? '')
    useStarbaseStore.getState().build(MARS, star, 100, builder)
    const record = useDiplomacyStore.getState().encroachments
    check('...and is recorded against the empire, the opinion cost still owed', record.length === 1 && record[0].againstId === empire.id && record[0].byId === MARS && record[0].kind === 'starbase' && record[0].applied === false)
    check('...with a notification to the player', useDiplomacyStore.getState().events.some((e) => e.kind === 'encroachment' && e.text.includes('unknown empire')))
    const claim = shownClaim(star, owners, starbaseOwnersOf(star, useStarbaseStore.getState().starbases, 100 + STARBASE_BUILD_DAYS), false)
    check('the system is then contested between Mars and the unknown empire', claim.kind === 'contested' && claim.countryIds.includes(MARS) && claim.countryIds.includes(UNKNOWN_EMPIRE_ID))
  }
  // Against a nation the opinion cost applies at once (the same rule, at home).
  fresh()
  useResourceStore.setState({ byCountry: {} })
  useDiplomacyStore.getState().reset()
  grantTech(MARS, 'orbital-construction')
  const b2 = spawnOwnedShip('construction-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().setShipCargo(b2, { ...STARBASE_COST })
  restAt(b2, 'alpha-centauri', 'Rigil Kentaurus')
  surveyAll(MARS, 'alpha-centauri')
  setInfluence(MARS, 100)
  const ORION = 'orion-republic'
  const before = useDiplomacyStore.getState().relations
  const opinionBefore = relationOf(before, MARS, ORION).opinion
  const ok = useStarbaseStore.getState().build(MARS, 'alpha-centauri', 100, b2)
  const opinionAfter = relationOf(useDiplomacyStore.getState().relations, MARS, ORION).opinion
  check('a Starbase in a nation\'s own system (Orion\'s Alpha Centauri) costs its opinion', ok.ok && opinionAfter - opinionBefore === OPINION_ON_ENCROACHMENT && OPINION_ON_ENCROACHMENT === -20, `${opinionBefore} -> ${opinionAfter}`)
  check('...recorded as applied', useDiplomacyStore.getState().encroachments.some((e) => e.againstId === ORION && e.applied))
  // Borders are a FULLY owned system: one shared by several owners (Sol) has none.
  check('a system with one other owner is its borders', encroachedOwners(MARS, [ORION]).join() === ORION)
  check('a shared system is nobody\'s borders', encroachedOwners(MARS, [ORION, 'republic-of-venus']).length === 0)
  check('...nor is one the builder already stands in', encroachedOwners(MARS, [MARS, ORION]).length === 0 && encroachedOwners(MARS, [MARS]).length === 0)
  check('nobody there: nobody encroached', encroachedOwners(MARS, []).length === 0)
  fresh()
  useDiplomacyStore.getState().reset()
  const solOwners = ownersPresent('sol', useTerritoryStore.getState().bodyOwner, [])
  const VENUS = 'republic-of-venus'
  const venusBefore = relationOf(useDiplomacyStore.getState().relations, MARS, VENUS).opinion
  const solRecords = recordEncroachments(MARS, 'sol', 'colony', 100, [])
  check('Sol is shared by several nations', solOwners.length > 1 && solOwners.includes(MARS) && solOwners.includes(VENUS), solOwners.join())
  check('a colony in the shared home system (Eris) encroaches on no one', solRecords.length === 0 && useDiplomacyStore.getState().encroachments.length === 0)
  check('...Venus\'s opinion is untouched, no notification', relationOf(useDiplomacyStore.getState().relations, MARS, VENUS).opinion === venusBefore && !useDiplomacyStore.getState().events.some((e) => e.kind === 'encroachment'))
}

console.log('\n=== 9. The AI\'s ships and nations pass and fail the same checks ===')
{
  fresh()
  useResourceStore.setState({ byCountry: {} })
  useDiplomacyStore.getState().reset()
  grantTech(VENUS, 'orbital-construction')
  const scout = spawnOwnedShip('science-ship', VENUS, 'sol', 'Venus')!
  check('the player\'s planner refuses another nation\'s ship', planMove(ship(scout), { kind: 'cluster', clusterId: NEAR }, day).kind === 'not-owned')
  const jump = go(scout, { kind: 'cluster', clusterId: NEAR }, planMoveUnchecked)
  check('an AI ship jumps to the cluster by the same planner the settler uses, charting Venus\'s own lane', jump.kind === 'instant' && shipClusterId(ship(scout)) === NEAR && useHyperlaneStore.getState().hasHyperlane(VENUS, SOLAR_NEIGHBORHOOD_ID, NEAR) && !useHyperlaneStore.getState().hasHyperlane(MARS, SOLAR_NEIGHBORHOOD_ID, NEAR))
  check('...and is refused a star of another cluster from there, as the player is', planMoveUnchecked(ship(scout), { kind: 'star', starId: 'sirius' }, day + 40).kind === 'unreachable')
  check('...and enters that cluster\'s systems', go(scout, { kind: 'star', starId: colonyStar.id }, planMoveUnchecked).kind === 'instant' && (ship(scout).location as { systemId?: string }).systemId === colonyStar.id)
  const aiBuilder = spawnOwnedShip('construction-ship', VENUS, 'sol', 'Venus')!
  useShipStore.getState().setShipCargo(aiBuilder, { ...STARBASE_COST })
  restAt(aiBuilder, colonyStar.id)
  setInfluence(VENUS, 1000)
  check('unsurveyed, the AI is refused too', !canBuildStarbase(VENUS, colonyStar.id, [], aiBuilder).ok)
  surveyAll(VENUS, colonyStar.id)
  const cost = starbaseInfluenceCostFor(VENUS, colonyStar.id, [])
  check('it pays the same distance cost', cost === starbaseInfluenceCostFor(MARS, colonyStar.id, []) && cost > STARBASE_INFLUENCE_COST)
  setInfluence(VENUS, cost - 1)
  check('...and is refused one influence short of it', !canBuildStarbase(VENUS, colonyStar.id, [], aiBuilder).ok)
  setInfluence(VENUS, cost)
  check('...and builds with it', useStarbaseStore.getState().build(VENUS, colonyStar.id, 100, aiBuilder).ok && influenceOf(VENUS) === 0)
  const aiColonist = spawnOwnedShip('colony-ship', VENUS, 'sol', 'Venus')!
  useShipStore.getState().setSettlers(aiColonist, 20)
  restAt(aiColonist, colonyStar.id, settleable(colonyStar.id)!)
  useGameTimeStore.setState({ simDays: 120 })
  check('no colony before its Starbase is finished, as for the player', !canColonize(ship(aiColonist), settleable(colonyStar.id)!).ok)
  useGameTimeStore.setState({ simDays: 100 + STARBASE_BUILD_DAYS + 1 })
  check('...and a colony after', canColonize(ship(aiColonist), settleable(colonyStar.id)!).ok)
  check('the AI Expander reads the same cost function', /starbaseInfluenceCostFor\(bb\.countryId/.test(readFileSync(new URL('../src/ai/expander.ts', import.meta.url), 'utf8')))
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
if (failures > 0) process.exit(1)
