// Settlements as they develop (scene/urban.ts, scene/urbanState.ts): population follows room, ground and
// work; a tier needs population, capacity and transport access together; specialization follows the jobs;
// nothing forces a colony to become a city.
//
// Run:  npx tsx tests/urban.test.ts
import { CATCHMENT_CELLS, POP_PER_CAPACITY, TIER_RULES } from '../src/data/urbanData'
import { urbanProfile, type UrbanInput } from '../src/scene/urban'
import { bodyPopulation, foundSettlement, urbanNow } from '../src/scene/urbanState'
import { locationsOf } from '../src/scene/locations'
import { defaultGeo } from '../src/scene/sovereignty'
import { resetGame } from '../src/scene/gameReset'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useEconomyStore } from '../src/state/economyStore'
import { useLocationStore, siteOwner } from '../src/state/locationStore'
import { usePlacementStore } from '../src/state/placementStore'
import { usePlayerStore } from '../src/state/playerStore'

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

const base = (over: Partial<UrbanInput> = {}): UrbanInput => ({
  bodyName: 'X',
  population: 1000,
  settlements: [
    { id: 'A', node: 0, capacity: 4, suitability: 1, capital: true },
    { id: 'B', node: 100, capacity: 2, suitability: 0.6, capital: false },
  ],
  placements: [],
  access: {},
  cellsBetween: (a, b) => Math.abs(a - b),
  ...over,
})
const find = (list: ReturnType<typeof urbanProfile>, id: string) => list.find((s) => s.id === id)!

console.log('\n=== 1. People follow room and ground ===')
{
  const p = urbanProfile(base())
  check('the people are shared out and add up to the world\'s population', Math.abs(p.reduce((n, s) => n + s.population, 0) - 1000) < 1e-6)
  check('the bigger, better site holds more', find(p, 'A').population > find(p, 'B').population, `${find(p, 'A').population.toFixed(0)}M vs ${find(p, 'B').population.toFixed(0)}M`)
  check('the capital with room and open roads is a metropolis; the smaller site a town', find(p, 'A').tier === 'metropolis' && find(p, 'B').tier === 'town')
  check('...and the capital is marked as such', find(p, 'A').specializations[0] === 'capital')
}

console.log('\n=== 2. Work draws people ===')
{
  const idle = find(urbanProfile(base()), 'B')
  const busy = find(urbanProfile(base({ placements: [{ siteId: 'mineB', node: 105, kind: 'resource', count: 10 }] })), 'B')
  check('ten buildings within reach of B draw people to it', busy.population > idle.population && busy.jobs === 10, `${idle.population.toFixed(0)}M -> ${busy.population.toFixed(0)}M`)
  check('...and its catchment lists the work that is its own', busy.catchment.join() === 'mineB')
  const far = find(urbanProfile(base({ placements: [{ siteId: 'lonely', node: 500, kind: 'resource', count: 10 }] })), 'B')
  check('work out of reach of every settlement belongs to none', far.population === idle.population && far.jobs === 0)
}

console.log('\n=== 3. A tier needs population, room AND roads ===')
{
  const cut = find(urbanProfile(base({ access: { A: 0.5 } })), 'A')
  check('a capital cut off from the world cannot be a metropolis, or a city: it falls back', cut.tier !== 'metropolis' && cut.tier !== 'city' && 0.5 < TIER_RULES.city.minAccess, cut.tier)
  check('...and it says what it would need', !!cut.next && cut.next.needs.some((n) => /transport access/.test(n)), JSON.stringify(cut.next))
  const tight = find(urbanProfile(base({ settlements: [{ id: 'A', node: 0, capacity: 2, suitability: 1, capital: false }] })), 'A')
  check('a million-strong site with only capacity 2 stays a town however big it gets', tight.tier === 'town' && tight.next?.needs.some((n) => /capacity/.test(n)) === true, `${tight.tier}, ${tight.next?.needs.join('; ')}`)
  const tiny = find(urbanProfile(base({ population: 3, settlements: [{ id: 'A', node: 0, capacity: 2, suitability: 1, capital: false }] })), 'A')
  check('a young colony of 3M people is an outpost: it need never become a city', tiny.tier === 'outpost' && tiny.next?.tier === 'town')
  const over = find(urbanProfile(base({ population: 5000, settlements: [{ id: 'A', node: 0, capacity: 2, suitability: 1, capital: false }] })), 'A')
  check('more people than the site can house is flagged as overcrowded', over.overcrowded && over.population > 2 * POP_PER_CAPACITY)
}

console.log('\n=== 4. Specialization follows the jobs ===')
{
  const mining = find(urbanProfile(base({ placements: [{ siteId: 'm1', node: 101, kind: 'resource', count: 4 }, { siteId: 'f1', node: 103, kind: 'industrial', count: 1 }] })), 'B')
  check('four of five jobs in mines: a mining town', mining.specializations.join() === 'mining', mining.specializations.join())
  const mixed = find(urbanProfile(base({ placements: [{ siteId: 'm1', node: 101, kind: 'resource', count: 2 }, { siteId: 'f1', node: 103, kind: 'industrial', count: 2 }, { siteId: 'p1', node: 104, kind: 'infrastructure', count: 2 }] })), 'B')
  check('an even mix has no single field to its name', mixed.specializations.length === 0)
  const few = find(urbanProfile(base({ placements: [{ siteId: 'm1', node: 101, kind: 'resource', count: 1 }] })), 'B')
  check('one building is not a specialty', few.specializations.length === 0)
  const port = find(urbanProfile(base({ placements: [{ siteId: 'p1', node: 99, kind: 'infrastructure', count: 3 }] })), 'B')
  check('a spaceport town is a port', port.specializations.join() === 'port')
}

console.log('\n=== 5. In the live game ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  const list = urbanNow('Mars', MARS)
  check('Mars\'s settlements are its established settlement sites, with the capital marked', list.length === locationsOf('Mars').filter((s) => s.kind === 'settlement').length && list.some((s) => s.specializations.includes('capital')), list.map((s) => `${s.id}:${s.tier}`).join(' '))
  check('their people add up to the world\'s', Math.abs(list.reduce((n, s) => n + s.population, 0) - bodyPopulation('Mars')) < 1e-6 && bodyPopulation('Mars') > 0)
  // A mine placed next to a settlement becomes work for it.
  const mine = locationsOf('Mars').find((s) => s.kind === 'resource' && !s.material)!
  useLocationStore.getState().establish(mine.id, MARS, 1)
  usePlacementStore.getState().place(mine.id, 'mine', 3)
  const after = urbanNow('Mars', MARS)
  const reach = locationsOf('Mars').filter((s) => s.kind === 'settlement' && siteOwner(s.id) === MARS).some((s) => defaultGeo.cellsBetween(s.node!, mine.node!) <= CATCHMENT_CELLS)
  check('three mines show up as the jobs of a settlement within reach, and of none out of reach', after.reduce((n, s) => n + s.jobs, 0) === (reach ? 3 : 0), reach ? 'in reach' : 'out of reach')
  // Founding.
  const second = locationsOf('Mars').filter((s) => s.kind === 'settlement' && !s.tags.includes('capital'))[0]
  useLocationStore.getState().abandon(second.id)
  check('an abandoned settlement site is open ground', !urbanNow('Mars', MARS).some((s) => s.id === second.id) && siteOwner(second.id) === undefined)
  const venus = foundSettlement(VENUS, second.id)
  check('Venus cannot found a settlement on Mars\'s ground without leave', !venus.ok && /permission/.test(venus.reason), venus.ok ? '' : venus.reason)
  const mars = foundSettlement(MARS, second.id)
  check('Mars can: the site is its own again, with a settlement claim', mars.ok && siteOwner(second.id) === MARS && urbanNow('Mars', MARS).some((s) => s.id === second.id))
  check('...and it is not founded twice', !foundSettlement(MARS, second.id).ok)
  void useAbstractEconomyStore
}

console.log('\n=== 6. Complex mode reads the same people ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'complex' })
  const world = useEconomyStore.getState().worlds.find((w) => w.id === 'Mars')!
  const total = world.pops.reduce((n, p) => n + p.populationSize, 0)
  const list = urbanNow('Mars', MARS)
  check('the population is the sum of Mars\'s pops, shared among the same settlements', Math.abs(bodyPopulation('Mars') - total) < 1e-6 && Math.abs(list.reduce((n, s) => n + s.population, 0) - total) < 1e-6 && list.length >= 1)
}

console.log(failures ? `\n${failures} FAILED` : '\nAll urban checks passed')
process.exit(failures ? 1 : 0)
