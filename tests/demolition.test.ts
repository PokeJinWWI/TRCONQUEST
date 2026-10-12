// Taking things down (scene/demolition.ts costs, scene/demolitionOrders.ts orders, unrest): farmland is cheap, factories heavy,
// a mine's clean-up grows with how deeply the site was worked, a city is heaviest and sends people away; it is paid for, the site
// it was done at is the one that shrinks, and the displaced leave unrest behind that fades.
//
// Run:  npx tsx tests/demolition.test.ts
import { demolitionQuote, demolitionWeight } from '../src/scene/demolition'
import { demolishBuilding, demolishLevel, planDemolishLevel } from '../src/scene/demolitionOrders'
import { resetGame } from '../src/scene/gameReset'
import { locationsOf } from '../src/scene/locations'
import { withoutDistrictLevel } from '../src/economy/districts'
import { seedWorlds } from '../src/economy/economySeed'
import { usePlayerStore } from '../src/state/playerStore'
import { useUnrestStore, unrestNow } from '../src/state/unrestStore'
import { usePlacementStore } from '../src/state/placementStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useEconomyStore } from '../src/state/economyStore'
import { syncUnrest } from '../src/scene/unrestSync'
import { UNREST_DECAY_DAYS } from '../src/data/demolitionData'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'

console.log('\n=== 1. The scale of costs ===')
{
  const w = (district: string, what: 'level' | 'building' = 'level', levelsHere = 1, populationMillions = 0) => demolitionWeight(demolitionQuote({ district, what, levelsHere, populationMillions }))
  check('farmland is the cheapest to remove', w('agricultural') < w('industrial') && w('agricultural') < w('mining') && w('agricultural') < w('urban'))
  check('a factory park is heavy work', w('industrial') > 5 * w('agricultural'))
  check('clearing a mine costs more the deeper the site was worked', w('mining', 'level', 4) > w('mining', 'level', 1))
  check('a city level is heavier than a factory level', w('urban') > w('industrial'))
  check('...and heavier with people living in it', w('urban', 'level', 1, 20) > w('urban', 'level', 1, 0))
  check('a building is a share of its district\'s level', w('industrial', 'building') < w('industrial') && w('industrial', 'building') > 0)
  const city = demolitionQuote({ district: 'urban', what: 'level', levelsHere: 2, populationMillions: 40 })
  check('a city level displaces people', city.displacedMillions > 0 && demolitionQuote({ district: 'agricultural', what: 'level', levelsHere: 1, populationMillions: 40 }).displacedMillions === 0)
  check('every quote asks for both goods and strategic resources', Object.keys(city.goods).length > 0 && Object.keys(city.resources).length > 0)
}

console.log('\n=== 2. Complex: taking a level off a world ===')
{
  const mars = seedWorlds().find((w) => w.id === 'Mars')!
  const r = withoutDistrictLevel(mars, 'agricultural')
  check('a level comes off, with its slots', r.ok && (r.world.districts as Record<string, number>).agricultural === ((mars.districts as Record<string, number>).agricultural - 1) && r.world.districtCapacity.agricultural === mars.districtCapacity.agricultural - 8)
  let to = mars
  let refusedAt = -1
  for (let i = 0; i < 40; i++) {
    const next = withoutDistrictLevel(to, 'urban')
    if (!next.ok) {
      refusedAt = i
      break
    }
    to = next.world
  }
  check('...but not once the buildings in it would no longer fit', refusedAt >= 0, `refused after ${refusedAt} levels`)
}

console.log('\n=== 3. Simple: ordering it, paying, and the right site ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  const farm = locationsOf('Mars').find((s) => s.kind === 'agricultural')!
  // One spare farmland level on Mars (the starting ones are full of farms), and the ledger says where it is.
  useAbstractEconomyStore.setState((st) => {
    const w = st.worlds['Mars']
    return { worlds: { ...st.worlds, Mars: { ...w, districts: { ...w.districts, agricultural: (w.districts.agricultural ?? 0) + 1 } } } }
  })
  usePlacementStore.getState().addLevel(farm.id, 'agricultural', 1)
  usePlacementStore.getState().markSeeded('Mars')
  for (const r of ['minerals', 'alloys'] as const) useResourceStore.getState().setAmount(MARS, r, 100000)
  const stock = () => useResourceStore.getState().stateFor(MARS).amounts
  const before = { ...stock() }
  const planned = planDemolishLevel(MARS, farm.id, 'agricultural')
  check('the plan quotes a cost the nation can meet', planned.ok, planned.ok ? JSON.stringify(planned.quote.resources) : planned.reason)
  const none = planDemolishLevel(MARS, farm.id, 'industrial')
  check('a level that is not developed there is refused', !none.ok)
  const foreign = planDemolishLevel(MARS, locationsOf('Venus')[0].id, 'agricultural')
  check('a world you do not govern is refused', !foreign.ok, foreign.ok ? '' : foreign.reason)
  const done = demolishLevel(MARS, farm.id, 'agricultural')
  if (done.ok) {
    const teardowns = useAbstractEconomyStore.getState().byCountry[MARS]?.teardowns ?? []
    check('it starts the deconstruction bar', teardowns.some((t) => t.district === 'agricultural' && t.bodyName === 'Mars'))
    const paid = Object.keys(planned.ok ? planned.quote.resources : {}).every((k) => (stock() as Record<string, number>)[k] < (before as Record<string, number>)[k])
    check('...and has been paid for', paid)
    check('the level comes off THIS site\'s ledger', (usePlacementStore.getState().levels[farm.id]?.agricultural ?? 0) === 0)
  } else check('demolishing the level succeeds or says why', done.ok, done.reason)
  void demolishBuilding
  resetGame()
}

console.log('\n=== 3b. Complex: levels and buildings go at once, for goods, and no salvage ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'complex' })
  const world = () => useEconomyStore.getState().worlds.find((w) => w.id === 'Mars')!
  useEconomyStore.getState().consumeStockpile('Mars', { concrete: 1000, steel: 1000, tools: 1000, chemicals: 1000 }, true)
  const farm = locationsOf('Mars').find((s) => s.kind === 'agricultural')!
  // A spare farmland level, recorded at the site.
  useEconomyStore.setState((st) => ({ worlds: st.worlds.map((w) => (w.id === 'Mars' ? { ...w, districts: { ...w.districts!, agricultural: (w.districts?.agricultural ?? 0) + 1 }, districtCapacity: { ...w.districtCapacity, agricultural: w.districtCapacity.agricultural + 8 } } : w)) }))
  usePlacementStore.getState().addLevel(farm.id, 'agricultural', 1)
  usePlacementStore.getState().markSeeded('Mars')
  const levelsBefore = (world().districts as Record<string, number>).agricultural
  const toolsBefore = world().stockpiles?.tools ?? 0
  const treasuryBefore = useEconomyStore.getState().countries.find((c) => c.id === MARS)!.treasury
  const r = demolishLevel(MARS, farm.id, 'agricultural')
  check('the level comes off the world at once', r.ok && (world().districts as Record<string, number>).agricultural === levelsBefore - 1, r.ok ? '' : r.reason)
  check('...paid in goods from the capital stockpile', (world().stockpiles?.tools ?? 0) < toolsBefore)
  check('...from the site that was pointed at', (usePlacementStore.getState().levels[farm.id]?.agricultural ?? 0) === 0)

  const mineSite = locationsOf('Mars').find((s) => s.kind === 'resource' && s.good)!
  const stateMine = world().buildings.find((b) => b.owner.kind === 'state' && b.recipeId.endsWith('Mine'))
  if (stateMine) {
    usePlacementStore.getState().place(mineSite.id, stateMine.recipeId, 1)
    const level = stateMine.level
    const b = demolishBuilding(MARS, mineSite.id, stateMine.recipeId)
    const after = world().buildings.find((x) => x.id === stateMine.id)
    check('a state building is taken down one level at a time', b.ok && (after ? after.level === level - 1 : level === 1), b.ok ? '' : b.reason)
    check('no salvage: the treasury does not grow from it', useEconomyStore.getState().countries.find((c) => c.id === MARS)!.treasury <= treasuryBefore + 1e-6)
  } else check('Mars has a state-owned mine to test with', false)
  const company = world().buildings.find((b) => b.owner.kind === 'corporation')
  if (company) {
    usePlacementStore.getState().place(mineSite.id, company.recipeId, 1)
    const refused = demolishBuilding(MARS, mineSite.id, company.recipeId)
    check('a company\'s building is not the state\'s to knock down', !refused.ok || world().buildings.some((x) => x.id === company.id && x.owner.kind === 'corporation'), refused.ok ? '' : refused.reason)
  }
  resetGame()
}

console.log('\n=== 4. Unrest ===')
{
  resetGame()
  const s = useUnrestStore.getState()
  s.add(MARS, 10, 100)
  check('displacing people leaves unrest', unrestNow(MARS, 100) > 0)
  check('...that fades', unrestNow(MARS, 100 + UNREST_DECAY_DAYS / 2) < unrestNow(MARS, 100))
  check('...to nothing at its deadline', unrestNow(MARS, 100 + UNREST_DECAY_DAYS) === 0)
  check('another nation feels none', unrestNow('republic-of-venus', 100) === 0)
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  syncUnrest()
  check('Simple: the nation\'s economy is told (and others are not)', (useAbstractEconomyStore.getState().byCountry[MARS]?.displacedUnrest ?? 0) > 0 && !useAbstractEconomyStore.getState().byCountry['republic-of-venus']?.displacedUnrest)
  usePlayerStore.setState({ economyModel: 'complex' })
  syncUnrest()
  check('Complex: every world of the nation is told', useEconomyStore.getState().worlds.filter((w) => w.ownerId === MARS).every((w) => (w.displacedUnrest ?? 0) > 0))
  useUnrestStore.getState().prune(100 + UNREST_DECAY_DAYS + 1)
  check('spent entries are dropped', Object.keys(useUnrestStore.getState().byNation).length === 0)
  resetGame()
}

console.log(failures ? `\n${failures} FAILED` : '\nAll demolition checks passed')
process.exit(failures ? 1 : 0)
