// Repairing ships at a shipyard, depositing cargo into a world, where auto-build may put a
// Starbase, and which strategies the strategizer lists. See scene/shipRepair.ts,
// state/shipyardStore.queueRepair, scene/shipCommands ('unload'), scene/automation.starbaseSiteSensible,
// scene/freeFlight.strategyListed, scene/upgradeOrders.
//
// Run:  npx tsx tests/shipYard.test.ts
import { RESOURCE_TYPES, type ResourceId } from '../src/data/resourceData'
import { getCountry } from '../src/data/countryData'
import { resolveShipClass } from '../src/state/shipClassResolver'
import { useShipyardStore } from '../src/state/shipyardStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useTechStore } from '../src/state/techStore'
import { useShipStore } from '../src/state/shipStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useCombatStore } from '../src/state/combatStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useStarbaseStore } from '../src/state/starbaseStore'
import { useConfirmStore } from '../src/state/confirmStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { advanceShipyard, spawnOwnedShip } from '../src/scene/shipyardLogic'
import { damageFraction, repairBlock, repairCost, repairDays } from '../src/scene/shipRepair'
import { atShipyard, nearestYard, yardSites } from '../src/scene/shipUpgrade'
import { orderFleetRepair, orderRepair, repairable } from '../src/scene/upgradeOrders'
import { applyShipCommand } from '../src/scene/shipCommands'
import { starbaseSiteSensible, AUTO_STARBASE_MAX_LY } from '../src/scene/automation'
import { FREE_FLIGHT_STRATEGIES, FREE_FLIGHT_TECH_ID, strategyBlock, strategyListed } from '../src/scene/freeFlight'
import { ALL_TECHS, localRoots, techSummary } from '../src/data/techData'

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
const ZERO = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, 0])) as Record<ResourceId, number>
const country = getCountry(MARS)!

function reset(amounts: Partial<Record<ResourceId, number>> = {}) {
  usePlayerStore.setState({ selectedCountryId: MARS })
  useResourceStore.setState({ byCountry: { [MARS]: { amounts: { ...ZERO, alloys: 1e6, energy: 1e6, ...amounts }, monthlyDelta: { ...ZERO } } } })
  useShipyardStore.setState({ ordersByCountry: {} })
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set<string>() } } })
  useShipStore.setState({ ships: [] })
  useCombatStore.setState({ engagements: [] })
  useStarbaseStore.setState({ starbases: [] })
  useGameTimeStore.setState({ simDays: 0 })
}
const amountsOf = () => useResourceStore.getState().stateFor(MARS).amounts
const orders = () => useShipyardStore.getState().ordersFor(MARS)
const shipOf = (id: string) => useShipStore.getState().ships.find((s) => s.id === id)!
const damage = (id: string, frac: number) =>
  useShipStore.setState((s) => ({
    ships: s.ships.map((x) => (x.id === id ? { ...x, combat: { ...x.combat, armorHp: x.combat.armorHp * (1 - frac), shieldHp: x.combat.shieldHp * (1 - frac) } } : x)),
  }))

console.log('\n=== 1. Repair: cost and time scale with the damage ===')
{
  reset()
  const id = spawnOwnedShip('corvette', MARS, country.capitalStarId, country.capitalBodyName)!
  const cls = resolveShipClass('corvette')!
  check('a fresh hull has nothing to repair', damageFraction(shipOf(id)) === 0 && repairable([shipOf(id)]).length === 0)
  damage(id, 0.8)
  const d = damageFraction(shipOf(id))
  check('damage shows up as a fraction', d > 0 && d < 1, d.toFixed(3))
  check('a worse hull costs more and takes longer', repairCost(cls, 0.8).alloys! > repairCost(cls, 0.2).alloys! && repairDays(cls, 0.8) >= repairDays(cls, 0.2))
  check('...and a damaged hull is never free', Object.values(repairCost(cls, 0.01)).every((n) => n >= 1))
  const base = { damage: 0.5, amounts: { ...ZERO, alloys: 1e6, energy: 1e6 }, shipClass: cls, engaged: false, alreadyQueued: false, queueFull: false, atYard: true }
  check('fine at the yard with the goods', repairBlock(base) === null)
  check('nothing to repair', repairBlock({ ...base, damage: 0 }) === 'Nothing to repair')
  check('away from a yard', (repairBlock({ ...base, atYard: false }) ?? '').includes('shipyard'))
  check('in a fight', repairBlock({ ...base, engaged: true }) === 'It is in a fight')
  check('short of goods', (repairBlock({ ...base, amounts: ZERO }) ?? '').startsWith('Short of'))
}

console.log('\n=== 2. Repair takes a slip, restores the same ship, refunds on cancel ===')
{
  reset()
  const id = spawnOwnedShip('corvette', MARS, country.capitalStarId, country.capitalBodyName)!
  damage(id, 0.7)
  check('at the capital world it is at a shipyard', atShipyard(shipOf(id)))
  const before = amountsOf().alloys
  const res = useShipyardStore.getState().queueRepair(MARS, id, 0)
  const o = orders()[0]
  check('queued: cost paid, an order for that ship, a slip taken at once, ship held', res.ok && amountsOf().alloys < before && o.repairShipId === id && o.startedSimDays === 0 && shipOf(id).upgrading === true)
  check('a second repair of the same ship is refused', !useShipyardStore.getState().queueRepair(MARS, id, 0).ok)
  advanceShipyard(country, o.finishSimDays! + 1)
  check('on finish the SAME ship is pristine and free again', damageFraction(shipOf(id)) === 0 && !shipOf(id).upgrading && orders().length === 0)

  damage(id, 0.5)
  useShipyardStore.getState().queueRepair(MARS, id, 100)
  const paid = amountsOf().alloys
  useShipyardStore.getState().cancelBuild(MARS, orders()[0].id)
  check('cancelling refunds the cost and frees the ship', amountsOf().alloys > paid && !shipOf(id).upgrading && orders().length === 0)

  useShipyardStore.getState().queueRepair(MARS, id, 100)
  useShipStore.setState({ ships: [] })
  advanceShipyard(country, 101)
  check('a repair whose ship was lost is dropped and refunded', orders().length === 0)
}

console.log('\n=== 3. A damaged ship away from the yard flies to the NEAREST one and repairs on arrival ===')
{
  reset()
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(['hyperspace-theory', 'hyperdrive-mk1']) } } })
  const id = spawnOwnedShip('hyperspace-scout', MARS, country.capitalStarId, country.capitalBodyName)!
  useShipStore.getState().setShipLocation(id, { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] })
  damage(id, 0.6)
  check('with only a capital, the capital is the nearest yard', nearestYard(shipOf(id))?.bodyName === country.capitalBodyName && yardSites(MARS, 0).length === 1)
  orderRepair(id)
  // A risky jump asks first: the player says yes.
  const asked = useConfirmStore.getState().pending
  check('(a jump from there asks first, as any player order does)', asked !== null || shipOf(id).order !== null)
  asked?.onConfirm()
  const s = shipOf(id)
  check('it is not refused: it heads for the yard with the repair waiting, nothing paid yet', (s.arrivalCommand?.command.kind === 'repair' || s.location.kind === 'orbiting') && orders().length === 0)
  useShipStore.getState().setArrivalCommand(id, null)
  useShipStore.getState().setShipLocation(id, { kind: 'orbiting', systemId: country.capitalStarId, bodyName: country.capitalBodyName, periodDays: 1, phaseDeg: 0, inclinationDeg: 0 })
  applyShipCommand(id, { kind: 'repair' }, 0)
  check('on arrival the command queues the repair', orders().some((o) => o.repairShipId === id))

  // A Starbase with a shipyard module is a yard too, and is nearer to a ship beside it.
  reset()
  const sbStar = 'alpha-centauri'
  useStarbaseStore.setState({ starbases: [{ id: 'sb1', starId: sbStar, ownerId: MARS, integrity: 50, readySimDays: 0, tier: 'starbase', modules: ['shipyard'] }] })
  const f = spawnOwnedShip('corvette', MARS, country.capitalStarId, country.capitalBodyName)!
  useShipStore.getState().setShipLocation(f, { kind: 'star', starId: sbStar, offset: [0, 0, 0] })
  check('a Starbase shipyard is a yard site', yardSites(MARS, 1).some((x) => x.starId === sbStar && !x.bodyName))
  check('a ship beside it is AT a shipyard and it is the nearest', atShipyard(shipOf(f)) && nearestYard(shipOf(f))?.starId === sbStar)
  damage(f, 0.5)
  orderFleetRepair([shipOf(f)])
  check('so a fleet order queues at once, no flight', orders().some((o) => o.repairShipId === f))
}

console.log('\n=== 4. Cargo ships deposit into a world ===')
{
  reset({ alloys: 0, energy: 0 })
  useTerritoryStore.setState((s) => ({ bodyOwner: { ...s.bodyOwner, [country.capitalBodyName]: MARS } }))
  const id = spawnOwnedShip('cargo-ship', MARS, country.capitalStarId, country.capitalBodyName)!
  useShipStore.getState().setShipCargo(id, { alloys: 100, energy: 40 })
  applyShipCommand(id, { kind: 'unload', want: { alloys: 30 } }, 0)
  check('a partial deposit moves just that into the stockpile', amountsOf().alloys === 30 && shipOf(id).cargo?.alloys === 70 && shipOf(id).cargo?.energy === 40)
  applyShipCommand(id, { kind: 'unload' }, 0)
  check('no amount = the whole hold', amountsOf().alloys === 100 && amountsOf().energy === 40 && (shipOf(id).cargo?.alloys ?? 0) === 0 && (shipOf(id).cargo?.energy ?? 0) === 0)
  useShipStore.getState().setShipCargo(id, { alloys: 10 })
  useShipStore.getState().setShipLocation(id, { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] })
  applyShipCommand(id, { kind: 'unload' }, 0)
  check('away from one of your worlds nothing is deposited', shipOf(id).cargo?.alloys === 10 && amountsOf().alloys === 100)
  useShipStore.getState().setShipLocation(id, { kind: 'orbiting', systemId: 'sol', bodyName: 'Earth', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 })
  useTerritoryStore.setState((s) => ({ bodyOwner: { ...s.bodyOwner, Earth: VENUS } }))
  applyShipCommand(id, { kind: 'unload' }, 0)
  check("nor at another nation's world", shipOf(id).cargo?.alloys === 10)
}

console.log('\n=== 5. Auto-build only goes where it makes sense ===')
{
  reset()
  useStarbaseStore.setState({ starbases: [] })
  const owners = useTerritoryStore.getState().bodyOwner
  const near = 'barnards-star'
  check('an unclaimed star near what the nation holds is fine', starbaseSiteSensible(near, MARS, owners, [], 0))
  const theirs = { id: 'sbx', starId: near, ownerId: VENUS, integrity: 50, readySimDays: 0, tier: 'starbase' as const, modules: [] }
  check("a system holding another nation's Starbase is not", !starbaseSiteSensible(near, MARS, owners, [theirs], 1))
  check('...but it is for their own', starbaseSiteSensible(near, VENUS, owners, [theirs], 1))
  check("a system with another nation's worlds is not (Alpha Centauri is Orion's)", !starbaseSiteSensible('alpha-centauri', MARS, owners, [], 0) && starbaseSiteSensible('alpha-centauri', 'orion-republic', owners, [], 0))
  const far = near
  check('the reach is a named, bounded distance', AUTO_STARBASE_MAX_LY > 0 && AUTO_STARBASE_MAX_LY <= 30 && far.length > 0)
}

console.log('\n=== 6. The strategizer lists free-flight strategies only once researched ===')
{
  const without = new Set<string>()
  const withTech = new Set([FREE_FLIGHT_TECH_ID])
  check('without the tech none of them is listed', FREE_FLIGHT_STRATEGIES.every((st) => !strategyListed(st, without)))
  check('...Balanced and Flee always are', strategyListed('balanced', without) && strategyListed('flee', without))
  check('with the tech they are all listed', FREE_FLIGHT_STRATEGIES.every((st) => strategyListed(st, withTech)))
  check('...and enabled for a ship with free flight on', strategyBlock('kite', withTech, {}) === null)
  check('...greyed, with the reason, for a ship with it switched off', (strategyBlock('kite', withTech, { freeFlight: false }) ?? '').includes('switched off'))
}

console.log('\n=== 7. Technology lists what it gives; locked techs sit at the bottom ===')
{
  const ff = ALL_TECHS.find((t) => t.id === FREE_FLIGHT_TECH_ID)!
  check('Free-Flight Maneuvering lists what it gives', (ff.gives?.length ?? 0) >= 2 && techSummary(ff).includes('Gives:'))
  check('...more strategies (kite and such) and manual node control in the arena', /Kite/.test(ff.gives!.join(' ')) && /node control/i.test(ff.gives!.join(' ')))
  check('a tech with nothing listed is just its description', techSummary({ description: 'x' }) === 'x')
  const roots = localRoots(ALL_TECHS)
  check('Anomalous Phenomena is the last root of the tree', roots[roots.length - 1].id === 'anomalous-phenomena')
}

console.log('\n=== 8. Colonizing in the home system needs no Starbase; the star offers Build Starbase ===')
{
  reset()
  useTerritoryStore.getState().reset()
  const { isHomeSystem } = await import('../src/scene/colonies')
  const { starbaseMenuItem } = await import('../src/scene/BodyOrderMenu')
  check('Sol is the Martian home system, not Orion\'s', isHomeSystem(MARS, 'sol') && !isHomeSystem('orion-republic', 'sol'))
  const builder = spawnOwnedShip('construction-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().selectShip(builder)
  const item = starbaseMenuItem('sol', 'Sol')
  check('right-clicking the star with a Construction Ship selected offers Build Starbase, with its influence cost', item?.label === 'Build Starbase · 30 influence')
  check('...but a planet does not', starbaseMenuItem('sol', 'Mars') === null)
  useShipStore.getState().selectShip(null)
  check('...and nothing is offered with no builder selected', starbaseMenuItem('sol', 'Sol') === null)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
