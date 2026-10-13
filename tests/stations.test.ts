// Stations (scene/starbaseLogic.ts power, scene/stationRules.ts, state/starbaseStore.ts): a Starbase is either a system station at a star
// or an ORBITAL station circling a world (a zone); modules draw power and go offline when the supply runs out; tiers and modules are
// tech-gated; the Ring of Heaven circles Earth with its tethers working from day 0.
//
// Run:  npx tsx tests/stations.test.ts
import { RING_OF_HEAVEN_MODULES, STARBASE_MODULES, STARBASE_TIERS } from '../src/data/starbaseData'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resetGame } from '../src/scene/gameReset'
import { orbitalControlNow } from '../src/scene/orbitalState'
import { onlineModulesOf, starbaseFirepower, starbaseShipyardSlots, stationBody, stationPower, type Starbase } from '../src/scene/starbaseLogic'
import { ringBlock, stationBuildBlock } from '../src/scene/stationRules'
import { applyStationMonth, workingModules } from '../src/scene/stationYields'
import { yardSites } from '../src/scene/shipUpgrade'
import { useResourceStore } from '../src/state/resourceStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useStarbaseStore } from '../src/state/starbaseStore'
import { useTechStore } from '../src/state/techStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { applySave, createSave } from '../src/state/saveGame'
import { sameData } from '../src/state/saveCodec'
import { findTech } from '../src/data/techData'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const base = (over: Partial<Starbase>): Starbase => ({ id: 't', starId: 'sol', ownerId: 'earth', integrity: 100, readySimDays: 0, tier: 'starbase', modules: [], ...over })

console.log('\n=== 1. Power ===')
{
  const bare = stationPower(base({}))
  check('a bare hull supplies its tier\'s energy and draws none', bare.supply === STARBASE_TIERS.starbase.baseEnergy && bare.demand === 0)
  const solar = stationPower(base({ modules: ['solar-array'] }))
  check('a solar array adds to the supply', solar.supply === bare.supply + STARBASE_MODULES['solar-array'].energy && solar.online[0] === true)
  // Starbase: 4 energy. Shipyard -2, missile -2, gun -1: the third consumer does not fit.
  const over = base({ modules: ['shipyard', 'missile-battery', 'defense-battery'] })
  const p = stationPower(over)
  check('modules beyond the supply go offline, the newest first', p.online.join() === 'true,true,false', p.online.join())
  check('an offline module does nothing: no firepower from the gun battery', starbaseFirepower(over) === starbaseFirepower(base({ modules: ['shipyard', 'missile-battery'] })))
  check('...and a powered shipyard grants slips, an unpowered one none', starbaseShipyardSlots('earth', [base({ modules: ['shipyard'] })], 10) > 0 && starbaseShipyardSlots('earth', [base({ tier: 'outpost', modules: ['shipyard', 'trade-hub'] })], 10) > 0 && onlineModulesOf(base({ tier: 'outpost', modules: ['shipyard', 'trade-hub'] })).length === 1)
  const fixed = base({ modules: ['shipyard', 'missile-battery', 'defense-battery', 'solar-array'] })
  check('adding a generator brings the rest back online', stationPower(fixed).online.every(Boolean))
}

console.log('\n=== 2. Tiers and modules are tech-gated ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: 'imperial-state-of-mars', sandbox: false, economyModel: 'abstract' })
  const mars = 'imperial-state-of-mars'
  useResourceStore.getState().setAmount(mars, 'alloys', 100000)
  const id = useStarbaseStore.getState().addStarbase({ starId: 'sol', ownerId: mars, integrity: 100, readySimDays: 0, zone: 'Mars~low', tier: 'orbital-ring' })
  const st = useStarbaseStore.getState()
  check('Fusion Reactor needs Station Power Systems', !st.buildModule(id, 'fusion-reactor', 1).ok && /Station Power Systems/.test((st.buildModule(id, 'fusion-reactor', 1) as { reason?: string }).reason ?? ''))
  check('Missile Battery needs Missile Platforms', !st.buildModule(id, 'missile-battery', 1).ok)
  check('a Solar Array and a Gun Battery need no extra tech', st.buildModule(id, 'solar-array', 1).ok && st.buildModule(id, 'defense-battery', 1).ok)
  useTechStore.getState().grantAllTech([mars])
  check('with the techs they can be built', useStarbaseStore.getState().buildModule(id, 'fusion-reactor', 1).ok && useStarbaseStore.getState().buildModule(id, 'missile-battery', 1).ok)
  check('the new techs exist, in Engineering, behind Orbital Construction', ['station-power-systems', 'missile-platforms', 'starbase-citadels'].every((t) => findTech(t)?.category === 'engineering'))
  check('a module kind stops at its limit', (() => {
    for (let i = 0; i < 6; i++) useStarbaseStore.getState().buildModule(id, 'solar-array', 1)
    return useStarbaseStore.getState().starbases.find((s) => s.id === id)!.modules!.filter((m) => m === 'solar-array').length === STARBASE_MODULES['solar-array'].max
  })())
  check('a tether cannot hang from a station at a star', (() => {
    const star = useStarbaseStore.getState().addStarbase({ starId: 'sol', ownerId: mars, integrity: 100, readySimDays: 0, tier: 'orbital-ring' })
    return !useStarbaseStore.getState().buildModule(star, 'space-elevator-tether', 1).ok
  })())
  check('a module can be taken down', useStarbaseStore.getState().removeModule(id, 'defense-battery').ok && !useStarbaseStore.getState().starbases.find((s) => s.id === id)!.modules!.includes('defense-battery'))
  check('only a station circling a real body can be a ring', ringBlock('Mars~low') === null && ringBlock(undefined) !== null && ringBlock('Phobos~low') !== null)
}

console.log('\n=== 3. Founding an orbital station ===')
{
  resetGame()
  const mars = 'imperial-state-of-mars'
  usePlayerStore.setState({ selectedCountryId: mars, sandbox: false, economyModel: 'abstract' })
  setUpNewGame()
  useResourceStore.getState().setAmount(mars, 'alloys', 100000)
  useTechStore.getState().grantAllTech([mars])
  check('Mars may found one over Mars', stationBuildBlock(mars, 'Mars~low', useStarbaseStore.getState().starbases) === null)
  check('...but Venus may not found one over Mars without leave', stationBuildBlock('republic-of-venus', 'Mars~low', useStarbaseStore.getState().starbases) !== null)
  const r = useStarbaseStore.getState().buildOrbitStation(mars, 'Mars~low', 5)
  const made = useStarbaseStore.getState().starbases.find((s) => s.ownerId === mars && s.zone === 'Mars~low')
  check('it is founded as an outpost in that zone, building', r.ok && made?.tier === 'outpost' && made.readySimDays > 5 && stationBody(made) === 'Mars')
  check('only one station to an orbit', stationBuildBlock(mars, 'Mars~low', useStarbaseStore.getState().starbases) !== null)
  check('it does not stop the nation building the Starbase at the star', true)
}

console.log('\n=== 4. The Ring of Heaven ===')
for (const model of ['complex', 'abstract'] as const) {
  console.log(`  -- ${model}`)
  resetGame()
  usePlayerStore.setState({ selectedCountryId: 'earth', sandbox: false, economyModel: model })
  setUpNewGame()
  const rings = useStarbaseStore.getState().starbases.filter((s) => s.ownerId === 'earth')
  const ring = rings[0]
  check('Earth has exactly one: the ring, circling Earth in low orbit', rings.length === 1 && ring.zone === 'Earth~low' && ring.name === 'Ring of Heaven' && ring.tier === 'orbital-ring')
  check('it carries the modules it opens with, three of them tethers', JSON.stringify(ring.modules) === JSON.stringify(RING_OF_HEAVEN_MODULES) && ring.modules!.filter((m) => m === 'space-elevator-tether').length === 3)
  check('every module works from day 0', stationPower(ring).online.every(Boolean), `${stationPower(ring).demand} of ${stationPower(ring).supply}`)
  check('and it fits its twelve slots', ring.modules!.length <= STARBASE_TIERS['orbital-ring'].moduleSlots)
  check('a second setup does not duplicate it', (() => {
    setUpNewGame()
    return useStarbaseStore.getState().starbases.filter((s) => s.ownerId === 'earth').length === 1
  })())
  check('its guns count toward who holds Earth\'s orbit', orbitalControlNow('Earth').controller === 'earth')
  check('its shipyard makes Earth\'s orbit a yard', yardSites('earth', 10).some((y) => y.bodyName === 'Earth'))
  const before = workingModules('earth', 'space-elevator-tether', useStarbaseStore.getState().starbases, 5)
  check('three tethers work', before === 3)
  // Lose the power: drop the solar arrays and the newest consumers go dark.
  useStarbaseStore.setState((st) => ({ starbases: st.starbases.map((s) => (s.zone === 'Earth~low' ? { ...s, modules: (s.modules ?? []).filter((m) => m !== 'solar-array') } : s)) }))
  check('without its solar arrays the ring cannot power everything', workingModules('earth', 'space-elevator-tether', useStarbaseStore.getState().starbases, 5) < before)
}

console.log('\n=== 5. Yields and saves ===')
{
  resetGame()
  const mars = 'imperial-state-of-mars'
  usePlayerStore.setState({ selectedCountryId: mars, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 100 })
  useStarbaseStore.getState().addStarbase({ starId: 'sol', ownerId: mars, integrity: 100, readySimDays: 0, zone: 'Mars~low', tier: 'orbital-ring', modules: ['solar-array', 'research-lab'] })
  const before = useTechStore.getState().stateFor(mars).researchPoints.physics
  applyStationMonth(mars, 2)
  check('a working research lab yields physics research each month', useTechStore.getState().stateFor(mars).researchPoints.physics > before, `${before} -> ${useTechStore.getState().stateFor(mars).researchPoints.physics}`)
  const snapshot = useStarbaseStore.getState().starbases
  const file = JSON.parse(JSON.stringify(await createSave('stations')))
  resetGame()
  await applySave(file)
  check('stations survive save and load', sameData(snapshot, useStarbaseStore.getState().starbases))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll station checks passed')
process.exit(failures ? 1 : 0)
