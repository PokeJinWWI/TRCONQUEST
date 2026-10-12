// Orbital jurisdiction and control (scene/orbits.ts, scene/orbitalState.ts, scene/orbitalOrders.ts):
// who governs an orbit, who owns what is in it, and who holds it by force are three different
// answers (acceptance D, E).
//
// Run:  npx tsx tests/orbital.test.ts
import { FACILITY_SPECS, ZONE_SLOTS } from '../src/data/orbitalData'
import { facilityFits, orbitalControl, orbitalZonesOf, zoneById, zoneId } from '../src/scene/orbits'
import { buildFacility, planFacility } from '../src/scene/orbitalOrders'
import { orbitalAccessNow, orbitalControlNow, orbitalForcesAt } from '../src/scene/orbitalState'
import { decideConstructionNow, fileClaimNow, grantPermission, jurisdictionNow, recognizeClaim } from '../src/scene/sovereignty'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { resetGame } from '../src/scene/gameReset'
import { canRecruitAt } from '../src/state/armyStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useEconomyStore } from '../src/state/economyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useOrbitalStore } from '../src/state/orbitalStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useShipStore } from '../src/state/shipStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { applySave, createSave } from '../src/state/saveGame'
import { sameData } from '../src/state/saveCodec'

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
const ORION = 'orion-republic'

function fresh(model: 'abstract' | 'complex' = 'abstract') {
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: model })
  useGameTimeStore.setState({ simDays: 0 })
  useShipStore.setState({ ships: [] })
  for (const n of [MARS, VENUS, ORION]) {
    useResourceStore.getState().setAmount(n, 'alloys', 10000)
  }
}
const fleet = (owner: string, body: string, n: number) => {
  for (let i = 0; i < n; i++) spawnOwnedShip('cruiser', owner, 'sol', body)
}

console.log('\n=== 1. Zones and facilities ===')
{
  const zones = orbitalZonesOf('Mars')
  check('every body has a low and a high orbit with their own slots', zones.map((z) => z.id).join() === 'Mars~low,Mars~high' && zones[0].slots === ZONE_SLOTS.low && zones[1].slots === ZONE_SLOTS.high)
  check('a zone id parses back to its body and kind', zoneById('Mars~high')?.bodyName === 'Mars' && zoneById('Mars~high')?.kind === 'high' && zoneById('Mars~moon') === undefined && zoneId('Titan', 'low') === 'Titan~low')
  check('a shipyard only in low orbit, a hub only in high', facilityFits(zoneById('Mars~low'), 'shipyard', 0).ok && !facilityFits(zoneById('Mars~high'), 'shipyard', 0).ok && facilityFits(zoneById('Mars~high'), 'hub', 0).ok && !facilityFits(zoneById('Mars~low'), 'hub', 0).ok)
  const full = facilityFits(zoneById('Mars~high'), 'station', ZONE_SLOTS.high)
  check('a full zone takes nothing more, and says so', !full.ok && /full/.test(full.reason))
  check('a nonexistent zone is refused', !facilityFits(undefined, 'station', 0).ok)
}

console.log('\n=== 2. Who holds an orbit by force ===')
{
  const war = (a: string, b: string) => a !== b && [a, b].sort().join() === ['a', 'b'].join()
  check('nobody armed: nobody holds it, and it is not contested', orbitalControl({}, war).controller === undefined && !orbitalControl({}, war).contested)
  check('one nation alone holds it', orbitalControl({ a: 2 }, war).controller === 'a')
  const close = orbitalControl({ a: 5, b: 3 }, war)
  check('two enemies without a 2:1 edge: contested, nobody holds it', close.controller === undefined && close.contested)
  const edge = orbitalControl({ a: 6, b: 3 }, war)
  check('a 2:1 edge over its enemies holds it', edge.controller === 'a' && !edge.contested)
  check('nations not at war share an orbit: the stronger is the controller', orbitalControl({ a: 3, c: 5 }, war).controller === 'c')
}

console.log('\n=== 3. Jurisdiction over an orbit ===')
{
  fresh()
  check('by default the planet\'s sovereign governs its orbits', jurisdictionNow({ kind: 'orbit', id: 'Mars~low' }).sovereign === MARS && jurisdictionNow({ kind: 'orbit', id: 'Mars~high' }).sovereign === MARS)
  const filed = fileClaimNow({ kind: 'orbit', id: 'Mars~high' }, VENUS, 'founding', 1)
  check('a claim on the high orbit alone makes THAT zone disputed and leaves the low one alone', filed.ok && jurisdictionNow({ kind: 'orbit', id: 'Mars~high' }).contested && !jurisdictionNow({ kind: 'orbit', id: 'Mars~low' }).contested)
  const rec = filed.ok ? recognizeClaim(filed.claim.id, { basis: 'treaty', simDays: 2, resolveRivals: true }) : { ok: false as const, reason: '' }
  check('recognized, Venus governs the high orbit of Mars while Mars still governs Mars', rec.ok && jurisdictionNow({ kind: 'orbit', id: 'Mars~high' }).sovereign === VENUS && jurisdictionNow({ kind: 'body', id: 'Mars' }).sovereign === MARS && useTerritoryStore.getState().bodyOwner['Mars'] === MARS)
}

console.log('\n=== 4. A foreign station (acceptance E) ===')
{
  fresh()
  const zone = 'Mars~high'
  const refused = planFacility(VENUS, zone, 'station')
  check('Venus needs Mars\'s permission to build in Mars\'s orbit', !refused.ok && /permission/.test(refused.reason), refused.ok ? '' : refused.reason)
  grantPermission({ id: 'st', grantorId: MARS, holderId: VENUS, scope: { kind: 'orbit', id: zone }, effect: 'allow', basis: 'treaty', since: 0 })
  const before = useResourceStore.getState().stateFor(VENUS).amounts.alloys
  const built = buildFacility(VENUS, zone, 'station')
  check('under the agreement it builds, and pays alloys', built.ok && before - useResourceStore.getState().stateFor(VENUS).amounts.alloys === FACILITY_SPECS.station.resources.alloys)
  check('the station is Venus\'s property', useOrbitalStore.getState().facilities.some((f) => f.ownerId === VENUS && f.zone === zone))
  check('...Mars still governs the orbit and the planet: no sovereignty came with it', jurisdictionNow({ kind: 'orbit', id: zone }).sovereign === MARS && jurisdictionNow({ kind: 'body', id: 'Mars' }).sovereign === MARS && useTerritoryStore.getState().bodyOwner['Mars'] === MARS)
  check('...and the station arms nobody: no force, no control', orbitalControlNow('Mars').controller === undefined)
  check('a second nation\'s station in the same zone is judged by the same sovereign', decideConstructionNow(ORION, { kind: 'orbit', id: zone }, 'orbital').legal === 'needs-permission')
}

console.log('\n=== 5. A sovereign without its orbit (acceptance D) ===')
{
  fresh()
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 0)
  fleet(VENUS, 'Mars', 3)
  const control = orbitalControlNow('Mars')
  check('Venus\'s warships hold Mars\'s orbit by force', control.controller === VENUS && (control.forces[VENUS] ?? 0) > 0, JSON.stringify(control.forces))
  check('Mars is still the sovereign of Mars and of its orbits', jurisdictionNow({ kind: 'body', id: 'Mars' }).sovereign === MARS && jurisdictionNow({ kind: 'orbit', id: 'Mars~low' }).sovereign === MARS)
  const access = orbitalAccessNow(MARS, 'Mars')
  check('Mars cannot reinforce, supply or evacuate through its own orbit', !access.ok && /enemy/.test(access.reason), access.ok ? '' : access.reason)
  check('...Venus can', orbitalAccessNow(VENUS, 'Mars').ok)
  const recruit = canRecruitAt(MARS, 'Mars')
  check('the existing recruiting rule agrees: blockaded', !recruit.ok && /Blockaded/.test(recruit.reason), recruit.ok ? '' : recruit.reason)
  const own = planFacility(MARS, 'Mars~low', 'station')
  check('Mars cannot build in an orbit an enemy holds', !own.ok && own.decision?.legal === 'military-restricted', own.ok ? '' : own.reason)
  const theirs = planFacility(VENUS, 'Mars~low', 'station')
  check('Venus holds the orbit but has no title: it still may not build there', !theirs.ok && theirs.decision?.legal !== 'authorized', theirs.ok ? '' : theirs.reason)
  useShipStore.setState({ ships: [] })
  check('when the fleet leaves, control lapses and Mars builds again', orbitalControlNow('Mars').controller === undefined && planFacility(MARS, 'Mars~low', 'station').ok)
  // Defense platforms hold an orbit for their owner.
  const platform = buildFacility(MARS, 'Mars~low', 'defense')
  useGameTimeStore.setState({ simDays: 1000 })
  fleet(VENUS, 'Mars', 1)
  const strength = orbitalForcesAt('Mars')
  check('a working defense platform adds armed strength for its owner', platform.ok && (strength[MARS] ?? 0) === FACILITY_SPECS.defense.power, JSON.stringify(strength))
  check('...and an unfinished one adds none', (() => { useGameTimeStore.setState({ simDays: 0 }); return (orbitalForcesAt('Mars')[MARS] ?? 0) === 0 })())
}

console.log('\n=== 6. Paying in Complex mode ===')
{
  fresh('complex')
  useEconomyStore.getState().consumeStockpile('Mars', { steel: 500, tools: 500 }, true)
  const stock = () => useEconomyStore.getState().worlds.find((w) => w.id === 'Mars')!.stockpiles as Record<string, number>
  const s0 = { ...stock() }
  const built = buildFacility(MARS, 'Mars~low', 'station')
  check('Complex: a station is paid in steel and tools from the capital stockpile', built.ok && s0.steel - stock().steel === FACILITY_SPECS.station.goods.steel && s0.tools - stock().tools === FACILITY_SPECS.station.goods.tools)
  useEconomyStore.getState().consumeStockpile('Mars', { steel: 1e9 })
  const poor = planFacility(MARS, 'Mars~low', 'station')
  check('...and refused when short, naming the good', !poor.ok && /Steel/i.test(poor.reason), poor.ok ? '' : poor.reason)
}

console.log('\n=== 7. Save and load ===')
{
  fresh()
  buildFacility(MARS, 'Mars~low', 'defense')
  const before = useOrbitalStore.getState().facilities
  const file = JSON.parse(JSON.stringify(await createSave('orbit')))
  resetGame()
  check('a reset clears the facilities', useOrbitalStore.getState().facilities.length === 0)
  await applySave(file)
  check('facilities survive save and load', sameData(before, useOrbitalStore.getState().facilities) && before.length === 1)
  resetGame()
}

console.log(failures ? `\n${failures} FAILED` : '\nAll orbital checks passed')
process.exit(failures ? 1 : 0)
